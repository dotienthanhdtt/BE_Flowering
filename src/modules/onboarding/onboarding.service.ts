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
import { StartOnboardingDto, OnboardingChatDto, OnboardingCompleteDto } from './dto';

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

  async startSession(dto: StartOnboardingDto) {
    const sessionToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + onboardingConfig.sessionTtlDays);

    const conversation = this.conversationRepo.create({
      sessionToken,
      type: AiConversationType.ANONYMOUS,
      expiresAt,
      title: 'Onboarding Chat',
      metadata: {
        nativeLanguage: dto.nativeLanguage,
        targetLanguage: dto.targetLanguage,
      },
    });
    const saved = await this.conversationRepo.save(conversation);

    return { sessionToken, conversationId: saved.id };
  }

  async chat(dto: OnboardingChatDto) {
    const conversation = await this.findValidSession(dto.sessionToken);
    const currentTurn = Math.floor(conversation.messageCount / 2) + 1;

    if (currentTurn > onboardingConfig.maxTurns) {
      throw new BadRequestException('Maximum turns reached. Call /onboarding/complete.');
    }

    const { nativeLanguage, targetLanguage } = conversation.metadata as Record<string, string>;
    const isLastTurn = currentTurn >= onboardingConfig.maxTurns;

    let systemPrompt = this.promptLoader.loadPrompt('onboarding-chat-prompt.md', {
      nativeLanguage,
      targetLanguage,
      currentTurn: String(currentTurn),
      maxTurns: String(onboardingConfig.maxTurns),
    });

    if (isLastTurn) {
      systemPrompt +=
        '\n\nIMPORTANT: This is the FINAL turn. Warmly summarize everything you have learned about the user and encourage them to start learning.';
    }

    const history = await this.getHistory(conversation.id);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(dto.message),
    ];

    const reply = await this.llmService.chat(messages, {
      model: onboardingConfig.llmModel,
      temperature: onboardingConfig.temperature,
      maxTokens: onboardingConfig.maxTokens,
      metadata: { feature: 'onboarding', conversationId: conversation.id, turn: currentTurn },
    });

    await this.saveMessage(conversation.id, MessageRole.USER, dto.message);
    const messageId = await this.saveMessage(conversation.id, MessageRole.ASSISTANT, reply);
    await this.conversationRepo.increment({ id: conversation.id }, 'messageCount', 2);

    return { reply, messageId, turnNumber: currentTurn, isLastTurn };
  }

  async complete(dto: OnboardingCompleteDto) {
    const conversation = await this.findValidSession(dto.sessionToken);
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
      temperature: 0.1,
      maxTokens: 512,
      metadata: { feature: 'onboarding-extraction', conversationId: conversation.id },
    });

    const profile = this.parseExtraction(response);
    const scenarios = await this.generateScenarios(profile, conversation.id);

    return { ...profile, scenarios };
  }

  private async generateScenarios(
    profile: Record<string, unknown>,
    conversationId: string,
  ): Promise<OnboardingScenarioDto[]> {
    try {
      const scenariosPrompt = this.promptLoader.loadPrompt('onboarding-scenarios-prompt.md', {
        nativeLanguage: String(profile.nativeLanguage ?? ''),
        targetLanguage: String(profile.targetLanguage ?? ''),
        currentLevel: String(profile.currentLevel ?? ''),
        learningGoals: Array.isArray(profile.learningGoals)
          ? profile.learningGoals.join(', ')
          : String(profile.learningGoals ?? ''),
        preferredTopics: Array.isArray(profile.preferredTopics)
          ? profile.preferredTopics.join(', ')
          : String(profile.preferredTopics ?? ''),
      });

      const response = await this.llmService.chat([new HumanMessage(scenariosPrompt)], {
        model: onboardingConfig.llmModel,
        temperature: 0.7,
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

  private async findValidSession(sessionToken: string): Promise<AiConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { sessionToken, type: AiConversationType.ANONYMOUS },
    });
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }
    if (conversation.expiresAt && conversation.expiresAt < new Date()) {
      throw new BadRequestException('Session expired');
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
