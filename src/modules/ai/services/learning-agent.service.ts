import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage } from '@langchain/core/messages';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel, ThinkingLevel } from '../providers/llm-models.enum';
import { LangfuseFeature } from '../langfuse-feature.enum';
import { AiConversationMessage } from '../../../database/entities/ai-conversation-message.entity';

/**
 * AI learning agent service providing grammar/vocabulary correction.
 */
@Injectable()
export class LearningAgentService {
  private readonly logger = new Logger(LearningAgentService.name);

  constructor(
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
  ) {}

  /**
   * Check grammar/vocabulary of user's chat reply in context of previous AI message.
   * Returns corrected text if errors found, null if correct.
   *
   * If `messageId` is provided, persists the result (including null) to
   * ai_conversation_messages.corrected_content. Persistence is best-effort —
   * failures are logged but do not affect the response.
   */
  async checkCorrection(
    previousAiMessage: string,
    userMessage: string,
    targetLanguage: string,
    conversationId?: string,
    messageId?: string,
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
      metadata: { feature: LangfuseFeature.CORRECTION_CHECK, conversationId },
    });

    const trimmed = response.trim().replace(/^["']|["']$/g, '');
    const correctedText = !trimmed || trimmed.toLowerCase() === 'null' ? null : trimmed;

    if (messageId) {
      try {
        await this.messageRepo.update({ id: messageId }, { correctedContent: correctedText });
      } catch (err) {
        this.logger.warn(
          `Failed to persist correctedContent for message ${messageId}: ${(err as Error).message}`,
        );
      }
    }

    return { correctedText };
  }
}
