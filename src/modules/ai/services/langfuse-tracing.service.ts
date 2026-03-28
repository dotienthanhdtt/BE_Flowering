import { Injectable } from '@nestjs/common';
import { CallbackHandler } from '@langfuse/langchain';

/**
 * Service for Langfuse LLM observability and tracing (v5).
 * Auth credentials are read from env vars by the OTel span processor.
 * Creates a fresh CallbackHandler per invocation so each LLM call
 * gets its own trace context and output is always captured.
 */
@Injectable()
export class LangfuseService {
  /**
   * Create a new callback handler per LLM invocation.
   * Each handler gets its own trace context to ensure output is captured.
   */
  getHandler(): CallbackHandler {
    return new CallbackHandler();
  }

  /**
   * Create a handler with user context for per-user tracing.
   */
  createUserHandler(userId: string, sessionId: string): CallbackHandler {
    return new CallbackHandler({
      userId,
      sessionId,
    });
  }
}