import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
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
import {
  ScenarioChatRequestDto,
  ScenarioChatResponseDto,
  ScenarioConversationListResponseDto,
} from '../dto/scenario-chat.dto';

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
  private readonly defaultModel = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;
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
  ) {}

  async chat(
    userId: string,
    dto: ScenarioChatRequestDto,
    languageId: string,
  ): Promise<ScenarioChatResponseDto> {
    // 1. Verify scenario access + language match
    const scenario = await this.scenarioAccessService.findAccessibleScenario(
      userId,
      dto.scenarioId,
      languageId,
    );

    // 2. Resolve conversation by (userId, scenarioId). Resume regardless of
    //    status (CHATTING or DONE); only create when none exists.
    let conversation: AiConversation;
    if (dto.conversationId) {
      conversation = await this.resolveExisting(userId, dto.conversationId, dto.scenarioId);
    } else {
      const result = await this.findOrCreate(userId, scenario.id, scenario.languageId);
      conversation = result.conversation;
    }

    // 3. If conversation is already DONE, return the full transcript without
    //    calling the LLM or mutating status.
    if (conversation.status === ScenarioChatStatus.DONE) {
      return this.getConversation(userId, conversation.id);
    }

    // 4. Load language context for the request's active learning language
    //    (NOT the user's stored isActive flag — header determines target).
    const langCtx = await this.loadLanguageContext(userId, languageId);

    // 5. Load history
    const history = await this.loadHistory(conversation.id);

    // 6. Compute turn metadata
    const maxTurns = (conversation.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;
    const currentTurn = Math.floor(history.length / 2) + 1;
    const status = history.length === 0 ? 'opening' : currentTurn >= maxTurns ? 'wrap' : 'mid';

    // 6b. Resolve injected vocabulary for this conversation
    const injectedVocab = await this.resolveInjectedVocabulary(
      conversation,
      langCtx.targetLangCode,
    );

    // 6c. Resolve learner display name (fallback to 'Learner' if unset)
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

    // 9. Call LLM
    const raw = await this.llmService.chat(messages, {
      model: this.defaultModel,
      metadata: {
        feature: LangfuseFeature.SCENARIO_CHAT,
        userId,
        conversationId: conversation.id,
        turn: currentTurn,
        scenarioId: scenario.id,
      },
    });

    const { reply, isEnd } = parseScenarioReply(raw);
    const trimmedReply = reply.trim();
    const userContent = dto.message?.trim();

    // 10. Persist messages — never insert empty content.
    if (userContent) {
      await this.msgRepo.save(
        this.msgRepo.create({
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: userContent,
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
    conversation.metadata = { ...(conversation.metadata ?? {}), maxTurns };
    await this.convoRepo.save(conversation);

    // 12. Fire-and-forget vocab usage tracking
    void this.trackUsage(conversation.id, userId, currentTurn, injectedVocab, userContent).catch(
      (err) =>
        this.logger.warn(`Usage-track failed conv=${conversation.id}: ${(err as Error).message}`),
    );

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

  private async findOrCreate(
    userId: string,
    scenarioId: string,
    languageId: string,
  ): Promise<{ conversation: AiConversation; created: boolean }> {
    const existing = await this.convoRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId AND c.scenarioId = :scenarioId', { userId, scenarioId })
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
          metadata: { maxTurns: MAX_TURNS },
        }),
      );
      return { conversation: inserted, created: true };
    } catch (err: unknown) {
      // Postgres unique violation (23505): concurrent request already inserted the row.
      // Re-query and return that row instead of propagating the error.
      if ((err as { code?: string }).code === '23505') {
        const race = await this.convoRepo
          .createQueryBuilder('c')
          .where('c.userId = :userId AND c.scenarioId = :scenarioId', { userId, scenarioId })
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

  /**
   * Lists all past scenario conversations owned by the user, newest first.
   * Owner-filter only (no premium gate) so users can still review history
   * after a subscription downgrade.
   */
  async listConversations(
    userId: string,
    scenarioId: string,
  ): Promise<ScenarioConversationListResponseDto> {
    const rows = await this.convoRepo.find({
      where: { userId, scenarioId },
      order: { createdAt: 'DESC' },
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        startedAt: r.createdAt.toISOString(),
        lastTurnAt: r.updatedAt.toISOString(),
        turnCount: Math.floor(r.messageCount / 2),
        status: r.status,
        maxTurns: (r.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS,
      })),
    };
  }

  /**
   * Fetches a single conversation with its full transcript.
   * Owner-check only — any authenticated user may read their own conversations,
   * even for scenarios they no longer have premium access to.
   */
  async getConversation(userId: string, conversationId: string): Promise<ScenarioChatResponseDto> {
    const c = await this.convoRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.userId !== userId) throw new ForbiddenException();

    const rows = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    const maxTurns = (c.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;

    return {
      scenario: {
        conversation_id: c.id,
        max_turns: maxTurns,
        turn: Math.floor(c.messageCount / 2),
        status: c.status,
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
      langs.find((l) => l.languageId === languageId) ?? langs.find((l) => l.lastLearned) ?? langs[0];
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
    return user?.displayName?.trim() || 'Learner';
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
