import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from 'langfuse-langchain';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * Service for Langfuse LLM observability and tracing.
 * Creates a fresh CallbackHandler per invocation so each LLM call
 * gets its own trace context and output is always captured.
 */
@Injectable()
export class LangfuseService {
  constructor(private configService: ConfigService<AppConfiguration>) {}

  /**
   * Create a new callback handler per LLM invocation.
   * Each handler gets its own trace context to ensure output is captured.
   * flushAt: 1 ensures traces are sent immediately after the call.
   */
  getHandler(): CallbackHandler {
    return this.createHandler();
  }

  /**
   * Create a handler with user context for per-user tracing.
   */
  createUserHandler(userId: string, sessionId: string): CallbackHandler {
    return new CallbackHandler({
      secretKey: this.configService.get('ai.langfuseSecretKey', { infer: true }),
      publicKey: this.configService.get('ai.langfusePublicKey', { infer: true }),
      baseUrl: this.configService.get('ai.langfuseHost', { infer: true }),
      userId,
      sessionId,
      flushAt: 1,
      flushInterval: 1000,
    });
  }

  private createHandler(): CallbackHandler {
    return new CallbackHandler({
      secretKey: this.configService.get('ai.langfuseSecretKey', { infer: true }),
      publicKey: this.configService.get('ai.langfusePublicKey', { infer: true }),
      baseUrl: this.configService.get('ai.langfuseHost', { infer: true }),
      flushAt: 1,
      flushInterval: 1000,
    });
  }
}
