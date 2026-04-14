import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { AiConversation, AiConversationMessage, MessageRole } from '@/database/entities';
import { AiConversationType } from '@/database/entities/ai-conversation.entity';
import { UnifiedLLMService } from '@/modules/ai/services/unified-llm.service';
import { PromptLoaderService } from '@/modules/ai/services/prompt-loader.service';
import { LLMModel } from '@/modules/ai/providers/llm-models.enum';
import { LanguageService } from '@/modules/language/language.service';
import { ScenarioAccessService } from './scenario-access.service';
import {
  ScenarioChatRequestDto,
  ScenarioChatResponseDto,
  ScenarioConversationDetailDto,
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
  private readonly defaultModel = LLMModel.GEMINI_2_0_FLASH;

  constructor(
    @InjectRepository(AiConversation)
    private readonly convoRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private readonly msgRepo: Repository<AiConversationMessage>,
    private readonly llmService: UnifiedLLMService,
    private readonly promptLoader: PromptLoaderService,
    private readonly languageService: LanguageService,
    private readonly scenarioAccessService: ScenarioAccessService,
  ) {}

  async chat(userId: string, dto: ScenarioChatRequestDto): Promise<ScenarioChatResponseDto> {
    // 0. Reject conflicting intent: forceNew + conversationId is ambiguous
    if (dto.forceNew && dto.conversationId) {
      throw new BadRequestException('Cannot combine forceNew with conversationId');
    }

    // 1. Verify scenario access
    const scenario = await this.scenarioAccessService.findAccessibleScenario(
      userId,
      dto.scenarioId,
    );

    // 2. If forceNew, mark any active conversation for this (user, scenario) as completed
    //    so the subsequent findOrCreate creates a fresh row.
    if (dto.forceNew) {
      await this.markActiveAsCompleted(userId, dto.scenarioId);
    }

    // 3. Resolve conversation
    const conversation = dto.conversationId
      ? await this.resolveExisting(userId, dto.conversationId, dto.scenarioId)
      : await this.findOrCreate(userId, scenario.id, scenario.languageId);

    // 4. Reject if already completed
    if (conversation.metadata?.['completed'] === true) {
      throw new BadRequestException(
        'Conversation is completed. Pass forceNew: true to start a new one.',
      );
    }

    // 4. Load language context
    const langCtx = await this.loadLanguageContext(userId);

    // 5. Load history
    const history = await this.loadHistory(conversation.id);

    // 6. Compute turn metadata
    const maxTurns = (conversation.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;
    const currentTurn = Math.floor(history.length / 2) + 1;
    const isOpening = history.length === 0;
    const isWrapUp = currentTurn >= maxTurns;

    // 7. Build system prompt
    const systemPrompt = this.promptLoader.loadPrompt('scenario-chat-prompt.json', {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description ?? '',
      scenarioCategory: scenario.category?.name ?? 'general',
      targetLanguage: langCtx.targetLanguage,
      nativeLanguage: langCtx.nativeLanguage,
      proficiencyLevel: langCtx.proficiencyLevel,
      currentTurn: String(currentTurn),
      maxTurns: String(maxTurns),
      isOpening: String(isOpening),
      isWrapUp: String(isWrapUp),
    });

    // 8. Build messages for LLM
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt), ...history];
    if (dto.message) messages.push(new HumanMessage(dto.message));

    // 9. Call LLM
    const reply = await this.llmService.chat(messages, {
      model: this.defaultModel,
      metadata: {
        feature: 'scenario_chat',
        conversationId: conversation.id,
        turn: currentTurn,
        scenarioId: scenario.id,
      },
    });

    // 10. Persist messages
    if (dto.message) {
      await this.msgRepo.save(
        this.msgRepo.create({
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: dto.message,
        }),
      );
    }
    await this.msgRepo.save(
      this.msgRepo.create({
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: reply,
      }),
    );

    // 11. Update conversation state
    const completed = currentTurn >= maxTurns;
    conversation.messageCount += dto.message ? 2 : 1;
    conversation.metadata = { ...(conversation.metadata ?? {}), maxTurns, completed };
    await this.convoRepo.save(conversation);

    return { reply, conversationId: conversation.id, turn: currentTurn, maxTurns, completed };
  }

  private async findOrCreate(
    userId: string,
    scenarioId: string,
    languageId: string | undefined,
  ): Promise<AiConversation> {
    const existing = await this.convoRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId AND c.scenarioId = :scenarioId', { userId, scenarioId })
      .andWhere(`c.metadata->>'completed' IS DISTINCT FROM 'true'`)
      .orderBy('c.createdAt', 'DESC')
      .getOne();

    if (existing) return existing;

    try {
      return await this.convoRepo.save(
        this.convoRepo.create({
          userId,
          scenarioId,
          languageId: languageId ?? null,
          type: AiConversationType.AUTHENTICATED,
          topic: 'scenario_roleplay',
          metadata: { maxTurns: MAX_TURNS, completed: false },
        }),
      );
    } catch (err: unknown) {
      // Postgres unique violation (23505): concurrent request already inserted the row.
      // Re-query and return that row instead of propagating the error.
      if ((err as { code?: string }).code === '23505') {
        const race = await this.convoRepo
          .createQueryBuilder('c')
          .where('c.userId = :userId AND c.scenarioId = :scenarioId', { userId, scenarioId })
          .andWhere(`c.metadata->>'completed' IS DISTINCT FROM 'true'`)
          .orderBy('c.createdAt', 'DESC')
          .getOne();
        if (race) return race;
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
   * Marks every active (non-completed) conversation for the given user+scenario
   * as completed. Used by the forceNew flow so that the subsequent findOrCreate
   * lookup will miss the old row and insert a fresh one.
   */
  private async markActiveAsCompleted(userId: string, scenarioId: string): Promise<void> {
    await this.convoRepo
      .createQueryBuilder()
      .update(AiConversation)
      .set({
        metadata: () => `COALESCE(metadata, '{}'::jsonb) || '{"completed":true}'::jsonb`,
      })
      .where('user_id = :userId AND scenario_id = :scenarioId', { userId, scenarioId })
      .andWhere(`metadata->>'completed' IS DISTINCT FROM 'true'`)
      .execute();
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
        completed: r.metadata?.['completed'] === true,
        maxTurns: (r.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS,
      })),
    };
  }

  /**
   * Fetches a single conversation with its full transcript.
   * Owner-check only — any authenticated user may read their own conversations,
   * even for scenarios they no longer have premium access to.
   */
  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ScenarioConversationDetailDto> {
    const c = await this.convoRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.userId !== userId) throw new ForbiddenException();

    const rows = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    // Surface only user/assistant turns to the client (drop any system rows).
    const messages = rows
      .filter((r) => r.role === MessageRole.USER || r.role === MessageRole.ASSISTANT)
      .map((r) => ({
        role: r.role as 'user' | 'assistant',
        content: r.content,
        createdAt: r.createdAt.toISOString(),
      }));

    const maxTurns = (c.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;

    return {
      id: c.id,
      scenarioId: c.scenarioId ?? '',
      completed: c.metadata?.['completed'] === true,
      turn: Math.floor(c.messageCount / 2),
      maxTurns,
      messages,
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
  ): Promise<{ targetLanguage: string; nativeLanguage: string; proficiencyLevel: string }> {
    const [langs, nativeLang] = await Promise.all([
      this.languageService.getUserLanguages(userId),
      this.languageService.getNativeLanguage(userId),
    ]);

    const active = langs.find((l) => l.isActive) ?? langs[0];
    if (!active) throw new BadRequestException('User has no active learning language');

    return {
      targetLanguage: active.language.name,
      nativeLanguage: nativeLang?.name ?? 'English',
      proficiencyLevel: active.proficiencyLevel,
    };
  }
}
