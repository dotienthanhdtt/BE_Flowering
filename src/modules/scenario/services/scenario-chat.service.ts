import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import {
  AiConversation,
  AiConversationMessage,
  MessageRole,
  User,
  VocabularyInjectionEvent,
} from '@/database/entities';
import { AiConversationType, ScenarioChatStatus } from '@/database/entities/ai-conversation.entity';
import { parseScenarioReply } from './scenario-llm-reply-parser';
import { Vocabulary } from '@/database/entities/vocabulary.entity';
import { UnifiedLLMService } from '@/modules/ai/services/unified-llm.service';
import { PromptLoaderService } from '@/modules/ai/services/prompt-loader.service';
import { LLMModel } from '@/modules/ai/providers/llm-models.enum';
import { LanguageService } from '@/modules/language/language.service';
import { VocabularyReviewService } from '@/modules/vocabulary/services/vocabulary-review.service';
import { ScenarioAccessService } from './scenario-access.service';
import { LangfuseFeature } from '@/modules/ai/langfuse-feature.enum';
import { VocabularyInjectionService } from './vocabulary-injection.service';
import { matchesWord } from './vocabulary-usage-matcher';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from '../dto/scenario-chat.dto';
import { PersonalizationTriggerService } from '@/modules/personalization/services/personalization-trigger.service';

const MAX_TURNS = 12;
// Cover full turn range: MAX_TURNS user + MAX_TURNS assistant + 2 buffer
const MAX_HISTORY = MAX_TURNS * 2 + 2;

/**
 * Handles scenario roleplay chat:
 * - Find-or-create conversation by (userId, scenarioId)
 * - Enforces 12-turn cap with wrap-up signal
 * - Persists user + assistant messages
 */
@Injectable()
export class ScenarioChatService {
  /** Primary model for scenario roleplay: routed through the 9router gateway. */
  private readonly defaultModel = LLMModel.NINEROUTER_FLOWERING_CHAT;
  /** Used when 9router is unavailable so a chat turn still completes. */
  private readonly fallbackModel = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;
  private readonly logger = new Logger(ScenarioChatService.name);

  constructor(
    @InjectRepository(AiConversation)
    private readonly convoRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private readonly msgRepo: Repository<AiConversationMessage>,
    @InjectRepository(VocabularyInjectionEvent)
    private readonly eventsRepo: Repository<VocabularyInjectionEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly llmService: UnifiedLLMService,
    private readonly promptLoader: PromptLoaderService,
    private readonly languageService: LanguageService,
    private readonly scenarioAccessService: ScenarioAccessService,
    private readonly vocabInjection: VocabularyInjectionService,
    private readonly vocabReview: VocabularyReviewService,
    private readonly personalizationTrigger: PersonalizationTriggerService,
  ) {}

  /**
   * Run a scenario-chat LLM call against 9router. If 9router is unavailable,
   * retry once against Gemini so the turn still completes. Any other error
   * propagates unchanged.
   */
  private async invokeLlmWithFallback(
    messages: BaseMessage[],
    metadata: Record<string, unknown>,
  ): Promise<string> {
    try {
      return await this.llmService.chat(messages, { model: this.defaultModel, metadata });
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        this.logger.warn(
          `9router unavailable for scenario chat; falling back to Gemini. ${String(err.message)}`,
        );
        return this.llmService.chat(messages, {
          model: this.fallbackModel,
          metadata: { ...metadata, fallback: 'ninerouter->gemini' },
        });
      }
      throw err;
    }
  }

  async chat(
    userId: string,
    dto: ScenarioChatRequestDto,
    languageId: string,
  ): Promise<ScenarioChatResponseDto> {
    // 1. Verify scenario access + language match. Single owner-aware lookup
    //    against unified `scenarios` table covers system, kol, and personal.
    const scenario = await this.resolveChatScenario(userId, dto.scenarioId, languageId);

    // 2. Resolve or create conversation.
    //    - With conversationId: load that specific row.
    //    - Without conversationId: pick the latest for (user, scenario) regardless
    //      of status; create only if none exists.
    let conversation: AiConversation;
    if (dto.conversationId) {
      conversation = await this.resolveExisting(userId, dto.conversationId, dto.scenarioId);
    } else {
      const latest = await this.convoRepo.findOne({
        where: { userId, scenarioId: scenario.id },
        order: { createdAt: 'DESC' },
      });
      if (latest) {
        conversation = latest;
      } else {
        const result = await this.findOrCreate(userId, scenario.id, scenario.languageId);
        conversation = result.conversation;
      }
    }

    // 2b. DONE short-circuit: do not run LLM, do not mutate state. Return the
    //     existing transcript with the conversation's actual status (DONE) so
    //     the client gets the final state without spawning a new conversation.
    if (conversation.status === ScenarioChatStatus.DONE) {
      return this.buildDoneResponse(conversation);
    }

    // 4. Load language context for the request's active learning language
    //    (NOT the user's stored isActive flag — header determines target).
    const langCtx = await this.loadLanguageContext(userId, languageId);

    // 5. Load history
    const history = await this.loadHistory(conversation.id);

    // 5b. No-op short-circuit: when client sends no user message and the last
    //     persisted message is already from the assistant, calling the LLM
    //     would produce back-to-back assistant turns. Return current state.
    const lastMsg = history[history.length - 1];
    if (!dto.message?.trim() && lastMsg instanceof AIMessage) {
      return this.buildCurrentStateResponse(conversation);
    }

    // 6. Compute turn metadata
    const maxTurns = conversation.maxTurns ?? MAX_TURNS;
    const currentTurn = Math.floor(history.length / 2) + 1;
    const status = history.length === 0 ? 'opening' : currentTurn >= maxTurns ? 'wrap' : 'mid';

    // 6b. Resolve injected vocabulary for this conversation
    const injectedVocab = await this.resolveInjectedVocabulary(
      conversation,
      langCtx.targetLangCode,
    );

    const learnerName = await this.resolveLearnerName(userId);

    // 7. Build system prompt
    const systemPrompt = this.promptLoader.loadPrompt('scenario-chat-prompt.json', {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description ?? '',
      scenarioCategory: scenario.category?.name ?? 'general',
      learnerName,
      targetLanguage: langCtx.targetLanguage,
      nativeLanguage: langCtx.nativeLanguage,
      proficiencyLevel: langCtx.proficiencyLevel,
      currentTurn: String(currentTurn),
      maxTurns: String(maxTurns),
      status,
      userVocabulary: this.formatVocabList(injectedVocab),
    });

    // 8. Build messages for LLM. Gemini requires at least one user message;
    //    a request with only systemInstruction returns 400 "contents is not
    //    specified". Push a 'Start' placeholder whenever there is no user input
    //    and no prior history — covers both fresh conversations and resumes of
    //    empty conversations (e.g. previous turn produced an empty reply that
    //    was skipped on persist).
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt), ...history];
    if (dto.message) {
      messages.push(new HumanMessage(dto.message));
    } else if (history.length === 0) {
      messages.push(new HumanMessage('Start'));
    }

    // 9. Call LLM (9router primary, Gemini fallback if 9router is unavailable)
    const raw = await this.invokeLlmWithFallback(messages, {
      feature: LangfuseFeature.SCENARIO_CHAT,
      userId,
      conversationId: conversation.id,
      turn: currentTurn,
      scenarioId: scenario.id,
      ...(dto.traceId ? { traceId: dto.traceId } : {}),
    });

    const { reply, isEnd } = parseScenarioReply(raw);
    const trimmedReply = reply.trim();
    const userContent = dto.message?.trim();

    // 10. Persist messages — never insert empty content.
    if (userContent) {
      // Only persist audioPath if it belongs to the caller's namespace
      // (prefix `${userId}/audio/`). Silently drop otherwise — bad value
      // shouldn't 400 the chat turn.
      const audioUrl =
        dto.audioPath && dto.audioPath.startsWith(`${userId}/audio/`)
          ? dto.audioPath
          : undefined;
      await this.msgRepo.save(
        this.msgRepo.create({
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: userContent,
          audioUrl,
        }),
      );
    }
    if (trimmedReply) {
      await this.msgRepo.save(
        this.msgRepo.create({
          conversationId: conversation.id,
          role: MessageRole.ASSISTANT,
          content: trimmedReply,
        }),
      );
    } else {
      this.logger.warn(`Empty assistant reply for conv=${conversation.id}; skipping persist.`);
    }

    // 11. Update conversation state
    conversation.messageCount += (userContent ? 1 : 0) + (trimmedReply ? 1 : 0);
    const turnAfter = Math.floor(conversation.messageCount / 2);
    const hardEnd = turnAfter >= maxTurns;
    conversation.status = isEnd || hardEnd ? ScenarioChatStatus.DONE : ScenarioChatStatus.CHATTING;
    if (conversation.status === ScenarioChatStatus.DONE && !conversation.completedAt) {
      conversation.completedAt = new Date();
    }
    await this.convoRepo.save(conversation);

    // 12. Fire-and-forget vocab usage tracking
    void this.trackUsage(conversation.id, userId, currentTurn, injectedVocab, userContent).catch(
      (err) =>
        this.logger.warn(`Usage-track failed conv=${conversation.id}: ${(err as Error).message}`),
    );

    // 12b. Fire-and-forget personalization trigger on scenario completion
    if (conversation.status === ScenarioChatStatus.DONE && conversation.scenarioId) {
      void this.personalizationTrigger
        .maybeTrigger(userId, conversation.scenarioId)
        .catch((err) =>
          this.logger.warn(
            `Personalization trigger failed conv=${conversation.id}: ${(err as Error).message}`,
          ),
        );
    }

    // 13. Re-query transcript for response
    const messageRows = await this.msgRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });
    const transcript = messageRows
      .filter((m) => m.role === MessageRole.USER || m.role === MessageRole.ASSISTANT)
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        created_at: m.createdAt.toISOString(),
      }));

    return {
      scenario: {
        conversation_id: conversation.id,
        max_turns: maxTurns,
        turn: turnAfter,
        status: conversation.status,
      },
      messages: transcript,
    };
  }

  private async resolveChatScenario(
    userId: string,
    scenarioId: string,
    languageId: string,
  ): Promise<{
    id: string;
    title: string;
    description: string | null;
    languageId: string;
    category: { name: string } | null;
  }> {
    const s = await this.scenarioAccessService.findAccessibleScenario(
      userId,
      scenarioId,
      languageId,
    );
    return {
      id: s.id,
      title: s.title,
      description: s.description ?? null,
      languageId: s.languageId,
      category: s.category ? { name: s.category.name } : null,
    };
  }

  private async findOrCreate(
    userId: string,
    scenarioId: string,
    languageId: string,
  ): Promise<{ conversation: AiConversation; created: boolean }> {
    const existing = await this.convoRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId AND c.scenarioId = :scenarioId AND c.status != :done', {
        userId,
        scenarioId,
        done: ScenarioChatStatus.DONE,
      })
      .orderBy('c.createdAt', 'DESC')
      .getOne();

    if (existing) return { conversation: existing, created: false };

    try {
      const inserted = await this.convoRepo.save(
        this.convoRepo.create({
          userId,
          scenarioId,
          languageId,
          type: AiConversationType.AUTHENTICATED,
          topic: 'scenario_roleplay',
          maxTurns: MAX_TURNS,
        }),
      );
      return { conversation: inserted, created: true };
    } catch (err: unknown) {
      // Postgres unique violation (23505): concurrent request already inserted the row.
      // Re-query and return that row instead of propagating the error.
      if ((err as { code?: string }).code === '23505') {
        const race = await this.convoRepo
          .createQueryBuilder('c')
          .where('c.userId = :userId AND c.scenarioId = :scenarioId AND c.status != :done', {
            userId,
            scenarioId,
            done: ScenarioChatStatus.DONE,
          })
          .orderBy('c.createdAt', 'DESC')
          .getOne();
        if (race) return { conversation: race, created: false };
      }
      throw err;
    }
  }

  private async resolveExisting(
    userId: string,
    conversationId: string,
    scenarioId: string,
  ): Promise<AiConversation> {
    const c = await this.convoRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.userId !== userId) throw new ForbiddenException();
    if (c.scenarioId !== scenarioId) throw new BadRequestException('scenarioId mismatch');
    return c;
  }

  private async buildCurrentStateResponse(
    conversation: AiConversation,
  ): Promise<ScenarioChatResponseDto> {
    return this.buildDoneResponse(conversation);
  }

  private async buildDoneResponse(conversation: AiConversation): Promise<ScenarioChatResponseDto> {
    const rows = await this.msgRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });
    const maxTurns = conversation.maxTurns ?? MAX_TURNS;
    return {
      scenario: {
        conversation_id: conversation.id,
        max_turns: maxTurns,
        turn: Math.floor(conversation.messageCount / 2),
        status: conversation.status,
      },
      messages: rows
        .filter((r) => r.role === MessageRole.USER || r.role === MessageRole.ASSISTANT)
        .map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content,
          created_at: r.createdAt.toISOString(),
        })),
    };
  }

  private async loadHistory(conversationId: string): Promise<BaseMessage[]> {
    const rows = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: MAX_HISTORY,
    });
    return rows.map((r) =>
      r.role === MessageRole.USER ? new HumanMessage(r.content) : new AIMessage(r.content),
    );
  }

  private async loadLanguageContext(
    userId: string,
    languageId: string,
  ): Promise<{
    targetLanguage: string;
    targetLangCode: string;
    nativeLanguage: string;
    proficiencyLevel: string;
  }> {
    const [langs, nativeLang] = await Promise.all([
      this.languageService.getUserLanguages(userId),
      this.languageService.getNativeLanguage(userId),
    ]);

    // Resolve target language by the request's X-Learning-Language (languageId),
    // falling back to the user's most recently learned language if not yet enrolled
    // (defensive — guard auto-enrolls).
    const target =
      langs.find((l) => l.languageId === languageId) ??
      langs.find((l) => l.lastLearned) ??
      langs[0];
    if (!target) throw new BadRequestException('User has no active learning language');

    return {
      targetLanguage: target.language.name,
      targetLangCode: target.language.code,
      nativeLanguage: nativeLang?.name ?? 'English',
      proficiencyLevel: target.proficiencyLevel,
    };
  }

  private async resolveInjectedVocabulary(
    conversation: AiConversation,
    targetLangCode: string,
  ): Promise<Vocabulary[]> {
    if (conversation.injectedVocabIds !== null && conversation.injectedVocabIds !== undefined) {
      return this.vocabInjection.hydrateByIds(conversation.injectedVocabIds);
    }
    try {
      const userId = conversation.userId;
      if (!userId) {
        throw new Error('Conversation has no userId');
      }
      const picked = await this.vocabInjection.selectVocabularyForConversation(
        userId,
        targetLangCode,
      );
      conversation.injectedVocabIds = picked.map((v) => v.id);
      await this.convoRepo.save(conversation);
      return picked;
    } catch (err) {
      this.logger.warn(
        `Vocab injection failed for conv ${conversation.id}: ${(err as Error).message}`,
      );
      conversation.injectedVocabIds = [];
      try {
        await this.convoRepo.save(conversation);
      } catch {
        /* swallow */
      }
      return [];
    }
  }

  private async resolveLearnerName(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'displayName'],
    });
    return user?.displayName?.trim() || '';
  }

  private formatVocabList(vocab: Vocabulary[]): string {
    if (!vocab.length) return '';
    return vocab.map((v) => `- ${v.word} (${v.translation}) [box ${v.box}]`).join('\n');
  }

  private async trackUsage(
    conversationId: string,
    userId: string,
    turnIndex: number,
    vocab: Vocabulary[],
    userMessage: string | undefined,
  ): Promise<void> {
    if (!userMessage || !vocab.length) return;
    const hits = vocab.map((v) => ({ vocabId: v.id, used: matchesWord(userMessage, v.word) }));
    const rows = hits.map((h) =>
      this.eventsRepo.create({
        conversationId,
        vocabularyId: h.vocabId,
        turnIndex,
        wasUsed: h.used,
      }),
    );
    await this.eventsRepo.save(rows);
    const usedIds = hits.filter((h) => h.used).map((h) => h.vocabId);
    await Promise.all(usedIds.map((id) => this.vocabReview.touchReviewed(userId, id)));
  }
}
