import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from '@/modules/ai';
import { LangfuseService } from '@/modules/ai';
import { AppConfiguration } from '@config/app-configuration';

/**
 * Google Gemini LLM provider implementation using LangChain.
 * Supports Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro, 1.5 Flash models.
 */
@Injectable()
export class GeminiLLMProvider implements LLMProvider {
  private readonly logger = new Logger(GeminiLLMProvider.name);

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private langfuseService: LangfuseService,
  ) {}

  private createModel(modelName: string, options?: LLMOptions): ChatGoogleGenerativeAI {
    const apiKey = this.configService.get('ai.googleAiApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('Google AI API key not configured');
    }
    return new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey,
      temperature: options?.temperature ?? 0,
      topP: options?.topP,
      maxOutputTokens: options?.maxTokens,
      streaming: true,
      callbacks: [this.langfuseService.getHandler(options?.metadata)],
      ...(options?.thinkingConfig && {
        thinkingConfig: options.thinkingConfig as Record<string, unknown>,
      }),
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    try {
      const model = this.createModel(options.model, options);
      const response = await model.invoke(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error('Gemini chat failed', (error as Error)?.message);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    try {
      const model = this.createModel(options.model, options);
      const stream = await model.stream(messages, {
        metadata: options.metadata,
        runName: (options.metadata?.feature as string) || undefined,
      });

      for await (const chunk of stream) {
        const content = chunk.content;
        yield typeof content === 'string' ? content : JSON.stringify(content);
      }
    } catch (error) {
      this.logger.error('Gemini stream failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    }
  }
}
