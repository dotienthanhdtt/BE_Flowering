import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * OpenAI LLM provider implementation using LangChain.
 * Supports GPT-4o, GPT-4o-mini, o1-preview, o1-mini models.
 */
@Injectable()
export class OpenAILLMProvider implements LLMProvider {
  private readonly logger = new Logger(OpenAILLMProvider.name);

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private langfuseService: LangfuseService,
  ) {}

  private createModel(
    modelName: string,
    options?: LLMOptions,
    handler?: ReturnType<LangfuseService['getHandler']>,
  ): ChatOpenAI {
    const apiKey = this.configService.get('ai.openaiApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key not configured');
    }
    return new ChatOpenAI({
      modelName,
      openAIApiKey: apiKey,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      streaming: true,
      callbacks: [handler ?? this.langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const handler = this.langfuseService.getHandler();
    try {
      const model = this.createModel(options.model, options, handler);
      const response = await model.invoke(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error('OpenAI chat failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    } finally {
      await handler.flushAsync();
    }
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const handler = this.langfuseService.getHandler();
    try {
      const model = this.createModel(options.model, options, handler);
      const stream = await model.stream(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });

      for await (const chunk of stream) {
        const content = chunk.content;
        yield typeof content === 'string' ? content : JSON.stringify(content);
      }
    } catch (error) {
      this.logger.error('OpenAI stream failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    } finally {
      await handler.flushAsync();
    }
  }
}
