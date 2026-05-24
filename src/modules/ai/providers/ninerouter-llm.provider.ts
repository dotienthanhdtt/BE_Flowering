import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AppConfiguration } from '@config/app-configuration';

/**
 * 9router LLM provider — an OpenAI-compatible AI gateway ("one key, many providers").
 * Uses LangChain's ChatOpenAI client pointed at the 9router base URL. Model names are
 * server-side aliases configured on 9router (e.g. `flowering_chat`).
 *
 * Langfuse tracing: `runName` is set to the feature tag (e.g. `scenario-chat`) so traces
 * are labelled by feature — same convention as the other LLM providers.
 */
@Injectable()
export class NineRouterLLMProvider implements LLMProvider {
  private readonly logger = new Logger(NineRouterLLMProvider.name);

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private langfuseService: LangfuseService,
  ) {}

  private createModel(modelName: string, options?: LLMOptions, streaming = false): ChatOpenAI {
    const apiKey = this.configService.get('ai.nineRouterKey', { infer: true });
    const baseUrl = this.configService.get('ai.nineRouterUrl', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('9router API key not configured');
    }
    return new ChatOpenAI({
      model: modelName,
      apiKey: apiKey,
      configuration: { baseURL: `${baseUrl}/v1` },
      temperature: options?.temperature ?? 0,
      topP: options?.topP,
      maxTokens: options?.maxTokens,
      streaming,
      callbacks: [this.langfuseService.getHandler(options?.metadata)],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    try {
      const model = this.createModel(options.model, options, false);
      const response = await model.invoke(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error('9router chat failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    try {
      const model = this.createModel(options.model, options, true);
      const stream = await model.stream(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });

      for await (const chunk of stream) {
        const content = chunk.content;
        yield typeof content === 'string' ? content : JSON.stringify(content);
      }
    } catch (error) {
      this.logger.error('9router stream failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }
}
