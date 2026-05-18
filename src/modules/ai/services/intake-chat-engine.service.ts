import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { AiConversation, AiConversationMessage, MessageRole } from '@/database/entities';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel } from '../providers/llm-models.enum';
import {
  IntakeChatEngineConfig,
  IntakeTurnResult,
  IntakeCompleteResult,
} from './intake-chat-engine.types';

const DEFAULT_MODEL = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;
const MAX_HISTORY = 20;

@Injectable()
export class IntakeChatEngine {
  private readonly logger = new Logger(IntakeChatEngine.name);

  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private readonly messageRepo: Repository<AiConversationMessage>,
    private readonly llmService: UnifiedLLMService,
    private readonly promptLoader: PromptLoaderService,
  ) {}

  async runTurn(
    conversationId: string,
    message: string | undefined,
    promptVars: Record<string, string>,
    config: IntakeChatEngineConfig,
    opts?: { traceId?: string; audioPath?: string },
  ): Promise<IntakeTurnResult> {
    const conversation = await this.findConversation(conversationId, config.conversationType);
    const msgCount = conversation.messageCount;
    const currentTurn = msgCount === 0 ? 1 : Math.floor((msgCount - 1) / 2) + 2;

    if (currentTurn > config.maxTurns) {
      throw new BadRequestException('Maximum turns reached. Call /complete.');
    }

    const systemPrompt = this.promptLoader.loadPrompt(config.chatPromptKey, {
      ...promptVars,
      currentTurn: String(currentTurn),
      maxTurns: String(config.maxTurns),
    });

    const isFirstTurn = msgCount === 0;
    if (!isFirstTurn && !message) {
      throw new BadRequestException('message required after first turn');
    }
    const turnMessage = message ?? 'Start';

    const history = await this.getHistory(conversationId);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(isFirstTurn ? 'Start' : turnMessage),
    ];

    const rawReply = await this.invokeChatTurnWithFallback(messages, config, {
      feature: config.chatFeature,
      conversationId,
      turn: currentTurn,
      ...(opts?.traceId ? { traceId: opts.traceId } : {}),
    });

    const { reply, isLastTurn } = this.parseChatReply(rawReply, currentTurn, config.maxTurns);

    if (!isFirstTurn) {
      // Accept audioPath only when it matches the onboarding namespace shape
      // (`onboarding:{uuid}/audio/...`). Anonymous flow has no strong identity
      // so this is a format/shape guard, not an ownership proof.
      const audioUrl = this.validateOnboardingAudioPath(opts?.audioPath);
      await this.saveMessage(conversationId, MessageRole.USER, turnMessage, audioUrl);
    }
    const messageId = await this.saveMessage(conversationId, MessageRole.ASSISTANT, reply);
    await this.conversationRepo.increment(
      { id: conversationId },
      'messageCount',
      isFirstTurn ? 1 : 2,
    );

    return { reply, messageId, turnNumber: currentTurn, isLastTurn };
  }

  /**
   * Run the per-turn chat call against {@link IntakeChatEngineConfig.chatModel}
   * (defaults to {@link DEFAULT_MODEL}). If that model is unavailable — e.g. the
   * 9router gateway is down — retry once against the configured fallback model so
   * the turn still completes. Any other error propagates unchanged.
   */
  private async invokeChatTurnWithFallback(
    messages: BaseMessage[],
    config: IntakeChatEngineConfig,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    const primary = config.chatModel ?? DEFAULT_MODEL;
    const fallback = config.chatFallbackModel ?? DEFAULT_MODEL;
    const opts = { temperature: 0, maxTokens: 1024 };
    try {
      return await this.llmService.chat(messages, { model: primary, ...opts, metadata });
    } catch (err) {
      if (err instanceof ServiceUnavailableException && primary !== fallback) {
        this.logger.warn(
          `Chat model ${primary} unavailable; falling back to ${fallback}. ${String(err.message)}`,
        );
        return this.llmService.chat(messages, {
          model: fallback,
          ...opts,
          metadata: { ...metadata, fallback: `${primary}->${fallback}` },
        });
      }
      throw err;
    }
  }

  async extractProfile(
    conversationId: string,
    config: IntakeChatEngineConfig,
  ): Promise<Record<string, unknown>> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const extractionPrompt = this.promptLoader.loadPrompt(config.extractionPromptKey, {
      transcript,
    });

    const response = await this.llmService.chat([new HumanMessage(extractionPrompt)], {
      model: DEFAULT_MODEL,
      temperature: 0,
      maxTokens: 512,
      metadata: { feature: config.extractionFeature, conversationId },
    });

    return this.parseJsonResponse(response);
  }

  async generateOutputs<T>(
    profile: Record<string, unknown>,
    conversationId: string,
    config: IntakeChatEngineConfig,
    parser: (raw: string) => T,
  ): Promise<T> {
    const scenariosPrompt = this.promptLoader.loadPrompt(config.scenariosPromptKey, {
      learnerProfile: JSON.stringify(profile),
    });

    const response = await this.llmService.chat([new HumanMessage(scenariosPrompt)], {
      model: DEFAULT_MODEL,
      temperature: 0,
      maxTokens: 1024,
      metadata: { feature: config.scenariosFeature, conversationId },
    });

    return parser(response);
  }

  async completeAndGenerate<T>(
    conversationId: string,
    config: IntakeChatEngineConfig,
    parser: (raw: string) => T,
    onGenerated: (profile: Record<string, unknown>, generated: T) => Promise<void>,
  ): Promise<IntakeCompleteResult<T>> {
    const profile = await this.extractProfile(conversationId, config);
    const generated = await this.generateOutputs(profile, conversationId, config, parser);
    await onGenerated(profile, generated);
    return { profile, generated };
  }

  async getMessages(
    conversationId: string,
    conversationType: string,
    maxTurns: number,
  ): Promise<{
    conversationId: string;
    turnNumber: number;
    maxTurns: number;
    isLastTurn: boolean;
    messages: Array<{ id: string; role: MessageRole; content: string; createdAt: Date }>;
  }> {
    const conversation = await this.findConversation(conversationId, conversationType);
    const rows = await this.messageRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    const msgCount = conversation.messageCount;
    const turnNumber = msgCount === 0 ? 0 : Math.floor((msgCount - 1) / 2) + 1;

    return {
      conversationId: conversation.id,
      turnNumber,
      maxTurns,
      isLastTurn: turnNumber >= maxTurns,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
      })),
    };
  }

  async findConversation(
    conversationId: string,
    conversationType: string,
  ): Promise<AiConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, type: conversationType as never },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private async getHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: MAX_HISTORY,
    });
    return messages.map((m) =>
      m.role === MessageRole.USER ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
  }

  private async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    audioUrl?: string,
  ): Promise<string> {
    const saved = await this.messageRepo.save({ conversationId, role, content, audioUrl });
    return saved.id;
  }

  private validateOnboardingAudioPath(audioPath: string | undefined): string | undefined {
    if (!audioPath) return undefined;
    // Onboarding STT uploads under `onboarding:{sessionId}/audio/...`. Reject
    // anything else so a stray path can't be attached to an onboarding row.
    return /^onboarding:[0-9a-f-]{36}\/audio\/.+/i.test(audioPath) ? audioPath : undefined;
  }

  private parseChatReply(
    raw: string,
    currentTurn: number,
    maxTurns: number,
  ): { reply: string; isLastTurn: boolean } {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      const parsed = JSON.parse(jsonStr);
      return {
        reply: String(parsed.reply ?? ''),
        isLastTurn: parsed.isLastTurn === true || currentTurn >= maxTurns,
      };
    } catch {
      this.logger.warn('Failed to parse chat reply JSON, using raw response');
      return { reply: raw, isLastTurn: currentTurn >= maxTurns };
    }
  }

  private parseJsonResponse(response: string): Record<string, unknown> {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      return JSON.parse(jsonStr);
    } catch {
      this.logger.warn('Failed to parse JSON response', { response });
      return { raw: response };
    }
  }
}
