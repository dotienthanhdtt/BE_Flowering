import { Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel, ThinkingLevel } from '../providers/llm-models.enum';
import { LangfuseFeature } from '../langfuse-feature.enum';

/**
 * AI learning agent service providing grammar/vocabulary correction.
 */
@Injectable()
export class LearningAgentService {
  constructor(
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
  ) {}

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
      metadata: { feature: LangfuseFeature.CORRECTION_CHECK, conversationId },
    });

    const trimmed = response.trim().replace(/^["']|["']$/g, '');
    const correctedText = !trimmed || trimmed.toLowerCase() === 'null' ? null : trimmed;
    return { correctedText };
  }
}
