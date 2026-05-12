import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { LLMProvider, LLMOptions } from './llm-provider.interface';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AppConfiguration } from '@config/app-configuration';

/**
 * 9router LLM provider — an OpenAI-compatible AI gateway ("one key, many providers").
 * Uses LangChain's ChatOpenAI client pointed at the 9router base URL. Model names are
 * server-side aliases configured on 9router (e.g. `flowering_chat`).
 *
 * ChatOpenAI (under Langfuse's OTel tracing) names the generation span after the GenAI
 * convention `"<operation> <model>"` (e.g. `chat flowering_chat`), so the LangChain
 * `runName` is not surfaced as the observation title. To keep Langfuse traces labelled
 * by feature (e.g. `scenario-chat`), each call is wrapped in a feature-named span that
 * nests under the conversation span: conversation → scenario-chat → chat <model>.
 */
@Injectable()
export class NineRouterLLMProvider implements LLMProvider {
  private readonly logger = new Logger(NineRouterLLMProvider.name);
  private readonly tracer = trace.getTracer('langfuse-sdk');

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private langfuseService: LangfuseService,
  ) {}

  private createModel(modelName: string, options?: LLMOptions): ChatOpenAI {
    const apiKey = this.configService.get('ai.nineRouterKey', { infer: true });
    const baseUrl = this.configService.get('ai.nineRouterUrl', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('9router API key not configured');
    }
    return new ChatOpenAI({
      modelName,
      openAIApiKey: apiKey,
      configuration: { baseURL: `${baseUrl}/v1` },
      temperature: options?.temperature ?? 0,
      topP: options?.topP,
      maxTokens: options?.maxTokens,
      streaming: true,
      callbacks: [this.langfuseService.getHandler(options?.metadata)],
    });
  }

  private spanName(options: LLMOptions, fallback: string): string {
    return (options.metadata?.feature as string) || fallback;
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const name = this.spanName(options, '9router-chat');
    return this.tracer.startActiveSpan(name, async (span) => {
      try {
        const model = this.createModel(options.model, options);
        const response = await model.invoke(messages, {
          metadata: options.metadata,
          runName: name,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error('9router chat failed', error);
        throw new ServiceUnavailableException('AI service temporarily unavailable');
      } finally {
        span.end();
      }
    });
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const name = this.spanName(options, '9router-stream');
    const span = this.tracer.startSpan(name);
    try {
      const model = this.createModel(options.model, options);
      const stream = await context.with(trace.setSpan(context.active(), span), () =>
        model.stream(messages, { metadata: options.metadata, runName: name }),
      );

      for await (const chunk of stream) {
        const content = chunk.content;
        yield typeof content === 'string' ? content : JSON.stringify(content);
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      this.logger.error('9router stream failed', error);
      throw new ServiceUnavailableException('AI service temporarily unavailable');
    } finally {
      span.end();
    }
  }
}
