import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel, ThinkingLevel } from '../providers/llm-models.enum';
import { AiConversation, AiConversationMessage, MessageRole } from '../../../database/entities';
import { ConversationContext } from '../dto';

/**
 * Main AI learning agent service providing tutoring features:
 * - Context-aware chat with AI tutor
 * - Grammar checking
 */
@Injectable()
export class LearningAgentService {
  private readonly defaultModel = LLMModel.GEMINI_2_0_FLASH;

  constructor(
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
  ) {}

  /**
   * Chat with the AI tutor. Returns full response.
   */
  async chat(
    userId: string,
    message: string,
    context: ConversationContext,
    model?: LLMModel,
  ): Promise<{ message: string; conversationId: string }> {
    if (!context.conversationId) {
      throw new BadRequestException('conversationId required');
    }
    await this.validateConversationOwnership(context.conversationId, userId);

    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt.md', {
      targetLanguage: context.targetLanguage,
      nativeLanguage: context.nativeLanguage,
      proficiencyLevel: context.proficiencyLevel,
      lessonTopic: context.lessonTopic || 'General conversation',
    });

    const history = await this.getConversationHistory(context.conversationId);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(message),
    ];

    const response = await this.llmService.chat(messages, {
      model: model || this.defaultModel,
      metadata: {
        userId,
        feature: 'chat',
        conversationId: context.conversationId,
      },
    });

    // Save messages to conversation history
    await this.saveMessage(context.conversationId, MessageRole.USER, message);
    await this.saveMessage(context.conversationId, MessageRole.ASSISTANT, response);

    // Update message count
    await this.conversationRepo.increment({ id: context.conversationId }, 'messageCount', 2);

    return { message: response, conversationId: context.conversationId };
  }

  /**
   * Stream chat response from AI tutor.
   */
  async *streamChat(
    userId: string,
    message: string,
    context: ConversationContext,
    model?: LLMModel,
  ): AsyncIterable<string> {
    if (!context.conversationId) {
      throw new BadRequestException('conversationId required');
    }
    await this.validateConversationOwnership(context.conversationId, userId);

    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt.md', {
      targetLanguage: context.targetLanguage,
      nativeLanguage: context.nativeLanguage,
      proficiencyLevel: context.proficiencyLevel,
      lessonTopic: context.lessonTopic || 'General conversation',
    });

    const history = await this.getConversationHistory(context.conversationId);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(message),
    ];

    let fullResponse = '';
    for await (const chunk of this.llmService.stream(messages, {
      model: model || this.defaultModel,
      metadata: {
        userId,
        feature: 'chat-stream',
        conversationId: context.conversationId,
      },
    })) {
      fullResponse += chunk;
      yield chunk;
    }

    // Save messages after streaming completes
    await this.saveMessage(context.conversationId, MessageRole.USER, message);
    await this.saveMessage(context.conversationId, MessageRole.ASSISTANT, fullResponse);
    await this.conversationRepo.increment({ id: context.conversationId }, 'messageCount', 2);
  }

  /**
   * Check grammar/vocabulary of user's chat reply in context of previous AI message.
   * Returns corrected text if errors found, null if correct.
   */
  async checkCorrection(
    previousAiMessage: string,
    userMessage: string,
    targetLanguage: string,
    conversationId?: string,
  ): Promise<{ correctedText: string | null }> {
    const prompt = this.promptLoader.loadPrompt('correction-check-prompt.json', {
      previousAiMessage,
      userMessage,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
      temperature: 0.0,
      maxTokens: 10000,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      metadata: { feature: 'correction-check', conversationId },
    });

    const trimmed = response.trim().replace(/^["']|["']$/g, '');
    const correctedText = !trimmed || trimmed.toLowerCase() === 'null' ? null : trimmed;
    return { correctedText };
  }

  /**
   * Get conversation history for a session.
   */
  async getConversationHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20, // Limit context window
    });

    return messages.map((m) =>
      m.role === MessageRole.USER ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
  }

  /**
   * Verify the conversation belongs to the requesting user.
   * Allows access to unowned conversations (anonymous onboarding).
   */
  private async validateConversationOwnership(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.userId && conversation.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<void> {
    await this.messageRepo.save({
      conversationId,
      role,
      content,
    });
  }
}
