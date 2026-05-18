import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiConversation, AiConversationMessage } from '@/database/entities';
import { ScenarioChatStatus } from '@/database/entities/ai-conversation.entity';
import { ScenarioEvaluation } from '@/database/entities/scenario-evaluation.entity';
import {
  ScenarioCompleteRequestDto,
  ScenarioCompleteResponseDto,
  EvaluationErrorCode,
} from '../dto/scenario-complete.dto';
import { ScenarioRecommenderService } from './scenario-recommender.service';
import { ScenarioAccessService } from './scenario-access.service';
import {
  ScenarioEvaluatorService,
  EvaluatorError,
  EvaluatorInput,
} from './scenario-evaluator.service';
import { LanguageService } from '@/modules/language/language.service';
import { PersonalizationTriggerService } from '@/modules/personalization/services/personalization-trigger.service';

const MAX_EVAL_RETRIES = 3;

@Injectable()
export class ScenarioCompleteService {
  private readonly logger = new Logger(ScenarioCompleteService.name);

  constructor(
    @InjectRepository(AiConversation)
    private readonly convoRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private readonly msgRepo: Repository<AiConversationMessage>,
    @InjectRepository(ScenarioEvaluation)
    private readonly evalRepo: Repository<ScenarioEvaluation>,
    private readonly dataSource: DataSource,
    private readonly scenarioAccessService: ScenarioAccessService,
    private readonly evaluator: ScenarioEvaluatorService,
    private readonly languageService: LanguageService,
    private readonly personalizationTrigger: PersonalizationTriggerService,
    private readonly recommender: ScenarioRecommenderService,
  ) {}

  async complete(
    userId: string,
    dto: ScenarioCompleteRequestDto,
    languageId: string,
  ): Promise<ScenarioCompleteResponseDto> {
    // 1. Resolve conversation first — enforces ownership; scenarioId derived from row
    const conversation = await this.resolveExisting(userId, dto.conversationId);

    // 2. Load scenario (ownership/visibility only — no premium gating on completion;
    //    user may have started chat while premium and lapsed, but their evaluation
    //    history must remain viewable).
    const scenario = await this.scenarioAccessService.findVisibleToUser(
      userId,
      conversation.scenarioId!,
      languageId,
    );

    // 3. Fast idempotency check outside the transaction — avoid unnecessary work
    const cached = await this.evalRepo.findOne({ where: { conversationId: conversation.id } });
    if (cached && cached.overallScore !== null) {
      return this.withRecommendations(
        this.buildResponse(conversation, cached, undefined),
        userId,
        scenario.id,
        scenario.categoryId ?? null,
        languageId,
      );
    }
    if (cached && cached.errorCount >= MAX_EVAL_RETRIES) {
      return this.withRecommendations(
        this.buildResponse(conversation, null, 'retry_cap_reached'),
        userId,
        scenario.id,
        scenario.categoryId ?? null,
        languageId,
      );
    }

    // 4. Load context outside the transaction to avoid holding a pool connection during I/O
    const [msgRows, langCtx] = await Promise.all([
      this.msgRepo.find({
        where: { conversationId: conversation.id },
        order: { createdAt: 'ASC' },
      }),
      this.loadLanguageContext(userId, languageId),
    ]);

    // 5. LLM evaluation outside the transaction — prevents holding pool connection during 15s call
    const evalInput: EvaluatorInput = {
      scenario: {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description ?? null,
      },
      messages: msgRows,
      langCtx,
      userId,
      conversationId: conversation.id,
    };

    let evalResult: Awaited<ReturnType<ScenarioEvaluatorService['evaluate']>> | null = null;
    let evalErrorCode: EvaluationErrorCode | undefined;
    try {
      evalResult = await this.evaluator.evaluate(evalInput);
    } catch (err) {
      if (err instanceof EvaluatorError) {
        evalErrorCode = err.code;
      } else {
        throw err;
      }
    }

    // 6. Short transaction: advisory lock + re-check + DONE flip + persist result
    let evaluation: ScenarioEvaluation | null = null;
    let evaluationErrorCode: EvaluationErrorCode | undefined = evalErrorCode;
    let triggerPersonalization = false;

    await this.dataSource.transaction(async (tx) => {
      // Advisory lock prevents concurrent inserts (not concurrent LLM calls — those are rare
      // and accepted as cheaper than holding a pool connection for 15s per lock holder).
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`complete:${conversation.id}`]);

      // Re-check inside lock — success OR retry cap (catches concurrent requests that both passed the fast check)
      const insideLock = await tx.findOne(ScenarioEvaluation, {
        where: { conversationId: conversation.id },
      });
      if (insideLock && insideLock.overallScore !== null) {
        evaluation = insideLock;
        return;
      }
      if (insideLock && insideLock.errorCount >= MAX_EVAL_RETRIES) {
        evaluationErrorCode = 'retry_cap_reached';
        return;
      }
      const tombstone = insideLock;

      // Flip status to DONE and record completedAt
      if (conversation.status !== ScenarioChatStatus.DONE || !conversation.completedAt) {
        conversation.status = ScenarioChatStatus.DONE;
        conversation.completedAt = new Date();
        await tx.save(AiConversation, conversation);
      }

      if (evalResult) {
        // ON CONFLICT (conversation_id) DO NOTHING — race-safe if two requests evaluated concurrently
        const inserted = await tx
          .createQueryBuilder()
          .insert()
          .into(ScenarioEvaluation)
          .values({
            conversationId: conversation.id,
            userId,
            scenarioId: scenario.id,
            overallScore: evalResult.overallScore,
            fluencyScore: evalResult.fluencyScore,
            accuracyScore: evalResult.accuracyScore,
            vocabScore: null,
            strengths: evalResult.strengths,
            improvements: evalResult.improvements,
            summary: evalResult.summary,
            vocabUsage: null,
            modelUsed: evalResult.modelUsed,
            promptVersion: evalResult.promptVersion,
            errorCount: 0,
            lastErrorCode: null,
          })
          .orIgnore()
          .returning('*')
          .execute();

        evaluation =
          (inserted.raw[0] as ScenarioEvaluation | undefined) ??
          (await tx.findOne(ScenarioEvaluation, { where: { conversationId: conversation.id } }));

        triggerPersonalization = true;
      } else {
        // Upsert tombstone: increment error_count to track retries, cap at MAX_EVAL_RETRIES
        const newCount = (tombstone?.errorCount ?? 0) + 1;
        this.logger.warn(
          `Evaluation failed conv=${conversation.id} attempt=${newCount} code=${evaluationErrorCode}`,
        );

        await tx
          .createQueryBuilder()
          .insert()
          .into(ScenarioEvaluation)
          .values({
            conversationId: conversation.id,
            userId,
            scenarioId: scenario.id,
            overallScore: null,
            fluencyScore: null,
            accuracyScore: null,
            vocabScore: null,
            strengths: [],
            improvements: [],
            summary: null,
            vocabUsage: null,
            modelUsed: null,
            errorCount: newCount,
            lastErrorCode: evaluationErrorCode ?? 'llm_unavailable',
          })
          .orUpdate(['error_count', 'last_error_code'], ['conversation_id'])
          .execute();
      }
    });

    // 7. Fire-and-forget personalization trigger (outside transaction)
    if (triggerPersonalization && scenario.id) {
      void this.personalizationTrigger.maybeTrigger(userId, scenario.id);
    }

    // 8. Build response
    return this.withRecommendations(
      this.buildResponse(conversation, evaluation, evaluationErrorCode),
      userId,
      scenario.id,
      scenario.categoryId ?? null,
      languageId,
    );
  }

  private async resolveExisting(userId: string, conversationId: string): Promise<AiConversation> {
    const c = await this.convoRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.userId !== userId) throw new ForbiddenException();
    if (!c.scenarioId) throw new BadRequestException('Conversation is not linked to a scenario');
    return c;
  }

  private async loadLanguageContext(
    userId: string,
    languageId: string,
  ): Promise<{ targetLanguage: string; nativeLanguage: string; proficiencyLevel: string }> {
    const [langs, nativeLang] = await Promise.all([
      this.languageService.getUserLanguages(userId),
      this.languageService.getNativeLanguage(userId),
    ]);
    const target =
      langs.find((l) => l.languageId === languageId) ??
      langs.find((l) => l.lastLearned) ??
      langs[0];
    if (!target) throw new BadRequestException('User has no active learning language');
    return {
      targetLanguage: target.language.name,
      nativeLanguage: nativeLang?.name ?? 'English',
      proficiencyLevel: target.proficiencyLevel,
    };
  }

  private async withRecommendations(
    response: ScenarioCompleteResponseDto,
    userId: string,
    anchorScenarioId: string,
    anchorCategoryId: string | null,
    languageId: string,
  ): Promise<ScenarioCompleteResponseDto> {
    response.next_scenarios = await this.recommender.recommendNext({
      userId,
      anchorScenarioId,
      anchorCategoryId,
      languageId,
    });
    return response;
  }

  private buildResponse(
    conversation: AiConversation,
    evalRow: ScenarioEvaluation | null,
    errorCode: EvaluationErrorCode | undefined,
  ): ScenarioCompleteResponseDto {
    const maxTurns = conversation.maxTurns ?? 12;
    const response: ScenarioCompleteResponseDto = {
      scenario: {
        conversation_id: conversation.id,
        max_turns: maxTurns,
        turn: Math.floor(conversation.messageCount / 2),
        status: conversation.status,
      },
      next_scenarios: [],
      evaluation:
        evalRow && evalRow.overallScore !== null
          ? {
              overall_score: evalRow.overallScore,
              fluency_score: evalRow.fluencyScore ?? 0,
              accuracy_score: evalRow.accuracyScore ?? 0,
              strengths: evalRow.strengths,
              improvements: evalRow.improvements,
              summary: evalRow.summary ?? '',
            }
          : null,
    };

    if (errorCode) {
      response.evaluation_error = errorCode;
    }

    return response;
  }
}
