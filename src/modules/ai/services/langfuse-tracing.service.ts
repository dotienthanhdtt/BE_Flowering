import { Injectable } from '@nestjs/common';
import { CallbackHandler } from '@langfuse/langchain';

/**
 * Service for Langfuse LLM observability and tracing (v5).
 * Creates a fresh CallbackHandler per invocation so each LLM call
 * gets its own trace context. Passes userId and sessionId (conversationId)
 * to group traces in the Langfuse dashboard.
 */
@Injectable()
export class LangfuseService {
  /**
   * Create a handler from LLM call metadata.
   * Maps conversationId → Langfuse sessionId for grouping.
   */
  getHandler(metadata?: Record<string, unknown>): CallbackHandler {
    return new CallbackHandler({
      userId: metadata?.userId as string | undefined,
      sessionId: metadata?.conversationId as string | undefined,
      tags: metadata?.feature ? [metadata.feature as string] : undefined,
    });
  }
}