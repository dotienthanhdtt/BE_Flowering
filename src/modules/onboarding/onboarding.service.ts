import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingScenarioDto, SCENARIO_ACCENT_COLORS } from './dto/onboarding-scenario.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { AiConversation, AiConversationMessage, MessageRole } from '../../database/entities';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { UnifiedLLMService } from '../ai/services/unified-llm.service';
import { PromptLoaderService } from '../ai/services/prompt-loader.service';
import { onboardingConfig } from './onboarding.config';
import { OnboardingChatDto, OnboardingCompleteDto } from './dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
  ) {}

  async handleChat(dto: OnboardingChatDto): Promise<{
    conversationId: string;
    reply: string;
    messageId: string;
    turnNumber: number;
    isLastTurn: boolean;
  }> {
    const conversationId =
      dto.conversationId ??
      (
        await this.startSession({
          nativeLanguage: dto.nativeLanguage!,
          targetLanguage: dto.targetLanguage!,
        })
      ).conversationId;
    const result = await this.chat({ conversationId, message: dto.message });
    return { conversationId, ...result };
  }

  private async startSession(args: { nativeLanguage: string; targetLanguage: string }) {
    const conversation = this.conversationRepo.create({
      type: AiConversationType.ANONYMOUS,
      title: 'Onboarding Chat',
      metadata: {
        nativeLanguage: args.nativeLanguage,
        targetLanguage: args.targetLanguage,
      },
    });
    const saved = await this.conversationRepo.save(conversation);

    return { conversationId: saved.id };
  }

  private async chat(args: { conversationId: string; message?: string }) {
    const conversation = await this.findValidSession(args.conversationId);
    // First turn saves 1 msg (assistant only), subsequent turns save 2 (user + assistant)
    const msgCount = conversation.messageCount;
    const currentTurn = msgCount === 0 ? 1 : Math.floor((msgCount - 1) / 2) + 2;

    if (currentTurn > onboardingConfig.maxTurns) {
      throw new BadRequestException('Maximum turns reached. Call /onboarding/complete.');
    }

    const { targetLanguage, nativeLanguage } = conversation.metadata as Record<string, string>;

    const systemPrompt = this.promptLoader.loadPrompt('onboarding-chat-prompt.json', {
      targetLanguage,
      nativeLanguage,
      currentTurn: String(currentTurn),
      maxTurns: String(onboardingConfig.maxTurns),
    });

    const isFirstTurn = msgCount === 0;
    if (!isFirstTurn && !args.message) {
      throw new BadRequestException('message required after first turn');
    }

    const history = await this.getHistory(conversation.id);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      ...(isFirstTurn ? [new HumanMessage('Start')] : [new HumanMessage(args.message!)]),
    ];

    const rawReply = await this.llmService.chat(messages, {
      model: onboardingConfig.llmModel,
      temperature: onboardingConfig.temperature,
      maxTokens: onboardingConfig.maxTokens,
      metadata: { feature: 'onboarding-chat', conversationId: conversation.id, turn: currentTurn },
    });

    const { reply, isLastTurn } = this.parseChatReply(rawReply, currentTurn);

    if (!isFirstTurn) {
      await this.saveMessage(conversation.id, MessageRole.USER, args.message!);
    }
    const messageId = await this.saveMessage(conversation.id, MessageRole.ASSISTANT, reply);
    await this.conversationRepo.increment(
      { id: conversation.id },
      'messageCount',
      isFirstTurn ? 1 : 2,
    );

    return { reply, messageId, turnNumber: currentTurn, isLastTurn };
  }

  async complete(dto: OnboardingCompleteDto) {
    const conversation = await this.findValidSession(dto.conversationId);

    // Cache hit: return previously extracted profile + scenarios to keep UUIDs stable
    // across resumes and avoid burning LLM tokens. Requires both fields populated and
    // a full 5-scenario payload (partial failures are retried on next call).
    if (
      conversation.extractedProfile &&
      Array.isArray(conversation.scenarios) &&
      conversation.scenarios.length === 5
    ) {
      return {
        ...(conversation.extractedProfile as Record<string, unknown>),
        scenarios: conversation.scenarios as unknown as OnboardingScenarioDto[],
      };
    }

    const messages = await this.messageRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    const extractionPrompt = this.promptLoader.loadPrompt('onboarding-extraction-prompt.md', {
      transcript,
    });

    const response = await this.llmService.chat([new HumanMessage(extractionPrompt)], {
      model: onboardingConfig.llmModel,
      temperature: 0,
      maxTokens: 512,
      metadata: { feature: 'onboarding-extraction', conversationId: conversation.id },
    });

    const profile = this.parseExtraction(response);
    const scenarios = await this.generateScenarios(profile, conversation.id);

    // Cache only on full success. Skip if profile parse fell back to {raw: ...} or if
    // scenario generation returned an incomplete payload (prevents sticky empty state).
    const isProfileStructured =
      !Object.prototype.hasOwnProperty.call(profile, 'raw') && Object.keys(profile).length > 0;
    if (isProfileStructured && scenarios.length === 5) {
      // Cast to `any` — TypeORM's DeepPartial rejects free-form JSONB shapes, but
      // the underlying column type is `jsonb` so any JSON-serializable value is valid.
      await this.conversationRepo.update(conversation.id, {
        extractedProfile: profile as any,
        scenarios: scenarios as any,
      });
    }

    return { ...profile, scenarios };
  }

  /**
   * Fetch full transcript for an anonymous onboarding conversation so mobile can
   * rehydrate the chat UI on resume. Non-anonymous conversations return 404 via
   * the shared `findValidSession` guard.
   */
  async getMessages(conversationId: string): Promise<{
    conversationId: string;
    turnNumber: number;
    maxTurns: number;
    isLastTurn: boolean;
    messages: Array<{ id: string; role: MessageRole; content: string; createdAt: Date }>;
  }> {
    const conversation = await this.findValidSession(conversationId);
    const rows = await this.messageRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    // Same turn formula as chat(): first turn stores assistant only (msgCount=1),
    // subsequent turns store user+assistant pairs (msgCount grows by 2).
    const msgCount = conversation.messageCount;
    const turnNumber = msgCount === 0 ? 0 : Math.floor((msgCount - 1) / 2) + 1;
    const isLastTurn = turnNumber >= onboardingConfig.maxTurns;

    return {
      conversationId: conversation.id,
      turnNumber,
      maxTurns: onboardingConfig.maxTurns,
      isLastTurn,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
      })),
    };
  }

  private async generateScenarios(
    profile: Record<string, unknown>,
    conversationId: string,
  ): Promise<OnboardingScenarioDto[]> {
    try {
      const scenariosPrompt = this.promptLoader.loadPrompt('onboarding-scenarios-prompt.json', {
        learnerProfile: JSON.stringify(profile),
      });

      const response = await this.llmService.chat([new HumanMessage(scenariosPrompt)], {
        model: onboardingConfig.llmModel,
        temperature: 0,
        maxTokens: 1024,
        metadata: { feature: 'onboarding-scenarios', conversationId },
      });

      return this.parseScenarios(response);
    } catch (error) {
      this.logger.warn('Failed to generate scenarios, returning empty array', { error });
      return [];
    }
  }

  private parseScenarios(response: string): OnboardingScenarioDto[] {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== 5) {
      throw new Error(
        `Expected 5 scenarios, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`,
      );
    }

    return parsed.map((s) => ({
      id: randomUUID(),
      title: String(s.title ?? ''),
      description: String(s.description ?? ''),
      icon: String(s.icon ?? 'star'),
      accentColor: (SCENARIO_ACCENT_COLORS.includes(s.accentColor)
        ? s.accentColor
        : 'primary') as OnboardingScenarioDto['accentColor'],
    }));
  }

  private async findValidSession(conversationId: string): Promise<AiConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, type: AiConversationType.ANONYMOUS },
    });
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }
    return conversation;
  }

  private async getHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20,
    });
    return messages.map((m) =>
      m.role === MessageRole.USER ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
  }

  private async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<string> {
    const saved = await this.messageRepo.save({ conversationId, role, content });
    return saved.id;
  }

  private parseChatReply(raw: string, currentTurn: number): { reply: string; isLastTurn: boolean } {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      const parsed = JSON.parse(jsonStr);
      return {
        reply: String(parsed.reply ?? ''),
        isLastTurn: parsed.isLastTurn === true || currentTurn >= onboardingConfig.maxTurns,
      };
    } catch {
      this.logger.warn('Failed to parse chat reply JSON, using raw response');
      return {
        reply: raw,
        isLastTurn: currentTurn >= onboardingConfig.maxTurns,
      };
    }
  }

  private parseExtraction(response: string): Record<string, unknown> {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      return JSON.parse(jsonStr);
    } catch {
      this.logger.warn('Failed to parse extraction JSON', { response });
      return { raw: response };
    }
  }
}
