import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CallbackHandler } from '@langfuse/langchain';
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';

/** Cached conversation span with last-access timestamp for TTL eviction. */
interface ConversationSpanEntry {
  span: Span;
  lastAccess: number;
}

/** TTL before idle conversation spans are ended (30 min). */
const SPAN_TTL_MS = 30 * 60 * 1000;

/** Eviction sweep interval (5 min). */
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

/** Hard cap to prevent unbounded Map growth under burst load. */
const MAX_CACHED_CONVERSATIONS = 5_000;

/**
 * Langfuse observability service providing hierarchical tracing.
 *
 * Creates a persistent OTel parent span per conversation so all LLM calls
 * nest under it as children — producing a tree view in Langfuse dashboard:
 *
 *   conversation (parent span)
 *   ├── chat #1 (LangChain trace → generation)
 *   ├── chat-stream #2 (LangChain trace → generation)
 *   └── correction-check #3 (LangChain trace → generation)
 *
 * Calls without a conversationId (e.g. standalone translation) get a flat trace.
 */
@Injectable()
export class LangfuseService implements OnModuleDestroy {
  private readonly tracer = trace.getTracer('langfuse-sdk');
  private readonly conversations = new Map<string, ConversationSpanEntry>();
  private readonly evictionTimer: ReturnType<typeof setInterval>;

  constructor() {
    const timer = setInterval(() => this.evictStaleSpans(), EVICTION_INTERVAL_MS);
    timer.unref(); // Don't block process exit
    this.evictionTimer = timer;
  }

  /**
   * Create a CallbackHandler for a LangChain LLM call.
   */
  getHandler(metadata?: Record<string, unknown>): CallbackHandler {
    return new CallbackHandler({
      userId: metadata?.userId as string | undefined,
      sessionId: metadata?.conversationId as string | undefined,
      tags: metadata?.feature ? [metadata.feature as string] : undefined,
    });
  }

  /**
   * Get the OTel context for a conversation so LLM calls nest under it.
   * Returns the active context with the conversation span set as parent.
   * For calls without conversationId, returns current context (no nesting).
   */
  getConversationContext(metadata?: Record<string, unknown>): ReturnType<typeof context.active> {
    const conversationId = metadata?.conversationId as string | undefined;
    if (!conversationId) return context.active();

    try {
      const entry = this.getOrCreateSpan(conversationId, metadata);
      entry.lastAccess = Date.now();
      return trace.setSpan(context.active(), entry.span);
    } catch {
      // OTel SDK error — fall back to flat trace
      return context.active();
    }
  }

  /** End all active conversation spans on shutdown. */
  onModuleDestroy(): void {
    clearInterval(this.evictionTimer);
    for (const [, entry] of this.conversations) {
      entry.span.end();
    }
    this.conversations.clear();
  }

  /** Get existing parent span or create a new one for the conversation. */
  private getOrCreateSpan(
    conversationId: string,
    metadata?: Record<string, unknown>,
  ): ConversationSpanEntry {
    const existing = this.conversations.get(conversationId);
    if (existing) return existing;

    // Evict oldest entry if at capacity
    if (this.conversations.size >= MAX_CACHED_CONVERSATIONS) {
      this.evictOldest();
    }

    const span = this.tracer.startSpan('conversation', {
      attributes: {
        'conversation.id': conversationId,
        'user.id': (metadata?.userId as string) || '',
      },
    });

    const entry: ConversationSpanEntry = { span, lastAccess: Date.now() };
    this.conversations.set(conversationId, entry);
    return entry;
  }

  /** Evict the oldest entry when Map hits capacity. */
  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Infinity;
    for (const [id, entry] of this.conversations) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.conversations.get(oldestId)?.span.end();
      this.conversations.delete(oldestId);
    }
  }

  /** End spans idle for longer than TTL. */
  private evictStaleSpans(): void {
    const now = Date.now();
    for (const [id, entry] of this.conversations) {
      if (now - entry.lastAccess > SPAN_TTL_MS) {
        entry.span.setStatus({ code: SpanStatusCode.OK });
        entry.span.end();
        this.conversations.delete(id);
      }
    }
  }
}
