import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * Anthropic LLM provider implementation using LangChain.
 * Supports Claude 3.5 Sonnet, Claude 3 Haiku models.
 */
@Injectable()
export class AnthropicLLMProvider implements LLMProvider {
  private readonly logger = new Logger(AnthropicLLMProvider.name);

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private langfuseService: LangfuseService,
  ) {}

  private createModel(modelName: string, options?: LLMOptions): ChatAnthropic {
    const apiKey = this.configService.get('ai.anthropicApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('Anthropic API key not configured');
    }
    return new ChatAnthropic({
      modelName,
      anthropicApiKey: apiKey,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 4096,
      streaming: true,
      callbacks: [this.langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    try {
      const model = this.createModel(options.model, options);
      const response = await model.invoke(messages, {
        metadata: options.metadata,
      });
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error('Anthropic chat failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    try {
      const model = this.createModel(options.model, options);
      const stream = await model.stream(messages, {
        metadata: options.metadata,
      });

      for await (const chunk of stream) {
        const content = chunk.content;
        yield typeof content === 'string' ? content : JSON.stringify(content);
      }
    } catch (error) {
      this.logger.error('Anthropic stream failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }
}
