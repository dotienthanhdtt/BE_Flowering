import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from 'langfuse-langchain';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * Service for Langfuse LLM observability and tracing.
 * Provides callback handlers for LangChain integration.
 */
@Injectable()
export class LangfuseService implements OnModuleDestroy {
  private handler: CallbackHandler | null = null;

  constructor(private configService: ConfigService<AppConfiguration>) {}

  async onModuleDestroy(): Promise<void> {
    if (this.handler) {
      await this.handler.flushAsync();
    }
  }

  /**
   * Get the default callback handler for LangChain.
   * Lazily initializes the handler on first use.
   */
  getHandler(): CallbackHandler {
    if (!this.handler) {
      this.handler = this.createHandler();
    }
    return this.handler;
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
