import { Injectable } from '@nestjs/common';
import { BaseMessage } from '@langchain/core/messages';
import { OpenAILLMProvider } from '../providers/openai-llm.provider';
import { AnthropicLLMProvider } from '../providers/anthropic-llm.provider';
import { GeminiLLMProvider } from '../providers/gemini-llm.provider';
import { LLMOptions, LLMProvider } from '../providers/llm-provider.interface';
import { LLMModel, getProviderFromModel } from '../providers/llm-models.enum';

/**
 * Unified LLM service that routes requests to the appropriate provider
 * based on the model enum value. Provides a single interface for all LLM operations.
 */
@Injectable()
export class UnifiedLLMService {
  constructor(
    private openaiProvider: OpenAILLMProvider,
    private anthropicProvider: AnthropicLLMProvider,
    private geminiProvider: GeminiLLMProvider,
  ) {}

  /**
   * Route to correct provider based on model enum.
   */
  private getProvider(model: LLMModel): LLMProvider {
    const providerType = getProviderFromModel(model);
    switch (providerType) {
      case 'openai':
        return this.openaiProvider;
      case 'anthropic':
        return this.anthropicProvider;
      case 'gemini':
        return this.geminiProvider;
    }
  }

  /**
   * Send a chat request to the appropriate LLM provider.
   */
  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const provider = this.getProvider(options.model);
    return provider.chat(messages, options);
  }

  /**
   * Stream a chat response from the appropriate LLM provider.
   */
  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const provider = this.getProvider(options.model);
    yield* provider.stream(messages, options);
  }
}
