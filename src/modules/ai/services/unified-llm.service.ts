import { Injectable } from '@nestjs/common';
import { context } from '@opentelemetry/api';
import { BaseMessage } from '@langchain/core/messages';
import { OpenAILLMProvider } from '../providers/openai-llm.provider';
import { AnthropicLLMProvider } from '../providers/anthropic-llm.provider';
import { GeminiLLMProvider } from '../providers/gemini-llm.provider';
import { LLMOptions, LLMProvider } from '../providers/llm-provider.interface';
import { LLMModel, getProviderFromModel } from '../providers/llm-models.enum';
import { LangfuseService } from './langfuse-tracing.service';

/**
 * Unified LLM service that routes requests to the appropriate provider
 * based on the model enum value. Provides a single interface for all LLM operations.
 * Wraps calls in the conversation's OTel context for hierarchical Langfuse tracing.
 */
@Injectable()
export class UnifiedLLMService {
  constructor(
    private openaiProvider: OpenAILLMProvider,
    private anthropicProvider: AnthropicLLMProvider,
    private geminiProvider: GeminiLLMProvider,
    private langfuseService: LangfuseService,
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
   * Runs within the conversation's OTel span context for hierarchical tracing.
   */
  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const provider = this.getProvider(options.model);
    const ctx = this.langfuseService.getConversationContext(options.metadata);
    return context.with(ctx, () => provider.chat(messages, options));
  }

  /**
   * Stream a chat response from the appropriate LLM provider.
   * Runs within the conversation's OTel span context for hierarchical tracing.
   */
  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const provider = this.getProvider(options.model);
    const ctx = this.langfuseService.getConversationContext(options.metadata);
    yield* context.with(ctx, () => provider.stream(messages, options));
  }
}
