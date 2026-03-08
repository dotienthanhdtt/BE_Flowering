import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel } from '../providers/llm-models.enum';
import { AiConversation, AiConversationMessage, MessageRole } from '../../../database/entities';
import {
  ConversationContext,
  GrammarCheckResult,
  ExerciseResult,
  PronunciationResult,
  CreateConversationDto,
} from '../dto';

/**
 * Main AI learning agent service providing tutoring features:
 * - Context-aware chat with AI tutor
 * - Grammar checking
 * - Exercise generation
 * - Pronunciation assessment
 */
@Injectable()
export class LearningAgentService {
  private readonly logger = new Logger(LearningAgentService.name);
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
   * Create a new conversation session.
   */
  async createConversation(userId: string, dto: CreateConversationDto): Promise<AiConversation> {
    const conversation = this.conversationRepo.create({
      userId,
      languageId: dto.languageId,
      title: dto.title,
      topic: dto.topic,
      metadata: dto.metadata,
    });
    return this.conversationRepo.save(conversation);
  }

  /**
   * Chat with the AI tutor. Returns full response.
   */
  async chat(
    userId: string,
    message: string,
    context: ConversationContext,
    model?: LLMModel,
  ): Promise<{ message: string; conversationId: string }> {
    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt', {
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
    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt', {
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
   * Check grammar in provided text.
   */
  async checkGrammar(
    text: string,
    targetLanguage: string,
    model?: LLMModel,
  ): Promise<GrammarCheckResult> {
    const prompt = this.promptLoader.loadPrompt('grammar-check-prompt', {
      text,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || LLMModel.GEMINI_1_5_FLASH,
      metadata: { feature: 'grammar-check' },
    });

    return this.parseJsonResponse<GrammarCheckResult>(response, {
      isCorrect: true,
      errors: [],
      correctedText: text,
    });
  }

  /**
   * Check grammar/vocabulary of user's chat reply in context of previous AI message.
   * Returns corrected text if errors found, null if correct.
   */
  async checkCorrection(
    previousAiMessage: string,
    userMessage: string,
    targetLanguage: string,
  ): Promise<{ correctedText: string | null }> {
    const prompt = this.promptLoader.loadPrompt('correction-check-prompt', {
      previousAiMessage,
      userMessage,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0.3,
      metadata: { feature: 'correction-check' },
    });

    const trimmed = response.trim().replace(/^["']|["']$/g, '');
    const correctedText = !trimmed || trimmed.toLowerCase() === 'null' ? null : trimmed;
    return { correctedText };
  }

  /**
   * Generate language learning exercise.
   */
  async generateExercise(
    exerciseType: string,
    targetLanguage: string,
    proficiencyLevel: string,
    topic: string,
    model?: LLMModel,
  ): Promise<ExerciseResult> {
    const prompt = this.promptLoader.loadPrompt('exercise-generator-prompt', {
      exerciseType,
      targetLanguage,
      proficiencyLevel,
      topic,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || this.defaultModel,
      metadata: { feature: 'exercise-generation' },
    });

    return this.parseJsonResponse<ExerciseResult>(response, {
      type: exerciseType,
      question: '',
      options: [],
      correctAnswer: '',
      explanation: '',
    });
  }

  /**
   * Assess pronunciation by comparing transcribed text to expected text.
   */
  async assessPronunciation(
    transcribedText: string,
    expectedText: string,
    targetLanguage: string,
    model?: LLMModel,
  ): Promise<PronunciationResult> {
    const prompt = this.promptLoader.loadPrompt('pronunciation-assessment-prompt', {
      transcribedText,
      expectedText,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || LLMModel.GEMINI_1_5_FLASH,
      metadata: { feature: 'pronunciation-assessment' },
    });

    return this.parseJsonResponse<PronunciationResult>(response, {
      score: 0,
      feedback: '',
      errors: [],
    });
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
   * Get raw conversation messages for API response.
   */
  async getConversationMessages(conversationId: string): Promise<AiConversationMessage[]> {
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
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

  private parseJsonResponse<T>(response: string, fallback: T): T {
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      return JSON.parse(jsonStr) as T;
    } catch (error) {
      this.logger.warn('Failed to parse LLM JSON response', { response, error });
      return fallback;
    }
  }
}
