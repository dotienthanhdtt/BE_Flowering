# Code Review: Hierarchical Langfuse Tracing

**Files reviewed (uncommitted working-tree changes):**
- `src/modules/ai/services/langfuse-tracing.service.ts` (23 -> 112 lines)
- `src/modules/ai/services/unified-llm.service.ts` (minor additions)

**Build:** Compiles cleanly.

---

## Critical Issues

### 1. Unbounded Map growth -- memory leak in production

**File:** `langfuse-tracing.service.ts` line 34

The `conversations` Map has **no max-size cap**. Eviction only runs every 5 min and only removes entries idle > 30 min. Between sweeps, a burst of unique `conversationId` values (e.g. onboarding sessions, or a replay attack with fabricated IDs) can grow the Map without bound.

**Impact:** OOM in long-running production process. The Map also holds live `Span` objects which themselves hold attribute buffers.

**Fix:** Add a hard cap (e.g. 10,000 entries). When inserting and size >= cap, evict the oldest entry immediately:

```ts
private readonly MAX_ENTRIES = 10_000;

private getOrCreateSpan(...): ConversationSpanEntry {
  const existing = this.conversations.get(conversationId);
  if (existing) return existing;

  // Hard cap: evict oldest if full
  if (this.conversations.size >= this.MAX_ENTRIES) {
    const [oldestId, oldestEntry] = this.conversations.entries().next().value;
    oldestEntry.span.setStatus({ code: SpanStatusCode.OK });
    oldestEntry.span.end();
    this.conversations.delete(oldestId);
  }
  // ... rest of creation
}
```

### 2. Span never ends on normal conversation completion

**File:** `langfuse-tracing.service.ts`

Spans are only ended by TTL eviction (30 min idle) or module destroy. There is no explicit `endConversation(conversationId)` method. This means:

- Every conversation span lives 30 min longer than needed
- Langfuse dashboard shows spans with inflated durations (span duration = last LLM call + 30 min idle timeout)
- If the eviction timer is slightly delayed (event loop busy), spans live even longer

**Fix:** Add an explicit end method and call it when conversations conclude:

```ts
endConversation(conversationId: string): void {
  const entry = this.conversations.get(conversationId);
  if (!entry) return;
  entry.span.setStatus({ code: SpanStatusCode.OK });
  entry.span.end();
  this.conversations.delete(conversationId);
}
```

This is informational rather than blocking since the current behavior is functionally correct, just wasteful.

---

## High Priority

### 3. `context.with()` does not propagate across async generator yields

**File:** `unified-llm.service.ts` line 57

```ts
async *stream(...): AsyncIterable<string> {
  const ctx = this.langfuseService.getConversationContext(options.metadata);
  yield* context.with(ctx, () => provider.stream(messages, options));
}
```

`context.with(ctx, fn)` sets the active context for the synchronous execution of `fn`. The `fn` here returns an `AsyncIterable`. The initial call to `provider.stream()` runs inside the context, but **subsequent `next()` calls on the async iterator** (triggered by `yield*`) execute in whatever context the consumer provides -- typically the root context.

This means: the first chunk of the stream may be traced correctly, but subsequent chunks lose the parent span association. Whether this matters depends on whether `@langfuse/langchain`'s `CallbackHandler` captures the context at stream-start or per-chunk. If it captures at start, this is fine. If per-chunk, tracing will be partial.

**Safer alternative:** Wrap the full iteration:

```ts
async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
  const provider = this.getProvider(options.model);
  const ctx = this.langfuseService.getConversationContext(options.metadata);
  const innerStream = context.with(ctx, () => provider.stream(messages, options));
  for await (const chunk of innerStream) {
    yield context.with(ctx, () => chunk); // re-establish context per yield if needed
  }
}
```

Or more pragmatically, since the LangChain callback handler captures context at stream creation, this may be a non-issue in practice. **Verify by checking a streaming trace in Langfuse dashboard.**

### 4. setInterval prevents graceful shutdown / keeps process alive

**File:** `langfuse-tracing.service.ts` line 38

The `setInterval` ref keeps the Node.js event loop alive even after NestJS calls `onModuleDestroy`. If the process is shutting down, the interval prevents exit until `clearInterval` runs -- but `clearInterval` is inside `onModuleDestroy` which may not fire if the process receives SIGKILL instead of SIGTERM.

**Fix:** Unref the timer so it does not prevent process exit:

```ts
constructor() {
  this.evictionTimer = setInterval(() => this.evictStaleSpans(), EVICTION_INTERVAL_MS);
  if (typeof this.evictionTimer === 'object' && 'unref' in this.evictionTimer) {
    this.evictionTimer.unref();
  }
}
```

---

## Medium Priority

### 5. No error handling around span operations

**File:** `langfuse-tracing.service.ts` lines 89-98

`tracer.startSpan()` and `trace.setSpan()` could theoretically throw if the OTel SDK is in a bad state (e.g. shutdown race). Since this is observability code, any failure here should not crash the LLM call.

**Fix:** Wrap in try-catch with fallback to flat context:

```ts
getConversationContext(metadata?: Record<string, unknown>): ReturnType<typeof context.active> {
  const conversationId = metadata?.conversationId as string | undefined;
  if (!conversationId) return context.active();

  try {
    const entry = this.getOrCreateSpan(conversationId, metadata);
    entry.callIndex += 1;
    entry.lastAccess = Date.now();
    return trace.setSpan(context.active(), entry.span);
  } catch {
    return context.active(); // degrade gracefully
  }
}
```

### 6. `callIndex` is tracked but never used

**File:** `langfuse-tracing.service.ts` line 9, 67

`callIndex` is incremented on every call but never read or set as a span attribute. Either use it (e.g. set as span attribute for debugging) or remove it to follow YAGNI.

### 7. Test impact -- existing tests still pass but no new tests

The existing `learning-agent-correction.service.spec.ts` mocks `UnifiedLLMService` entirely, so the new `LangfuseService` dependency injected into `UnifiedLLMService` is invisible to tests. This is fine for existing tests but means the new tracing logic has **zero test coverage**.

At minimum, add a unit test for `LangfuseService`:
- `getConversationContext` returns active context when no conversationId
- `getConversationContext` returns a modified context when conversationId is present
- `evictStaleSpans` removes entries older than TTL
- `onModuleDestroy` clears all spans

---

## Low Priority

### 8. Missing newline at EOF in committed version

The committed version of `langfuse-tracing.service.ts` (on HEAD) lacks a trailing newline. The working-tree version fixes this. Minor but causes noisy diffs.

---

## Positive Observations

- Clean separation: tracing is purely in the service layer, providers are unaware of conversation grouping
- `context.with()` approach is idiomatic OTel
- Fallback to flat traces for calls without conversationId is correct
- TTL eviction is a reasonable approach for the Map cache
- `OnModuleDestroy` cleanup is implemented

---

## Recommended Actions (priority order)

1. **[Critical]** Add max-size cap to the conversations Map
2. **[High]** Unref the eviction timer
3. **[High]** Verify streaming trace correctness in Langfuse dashboard
4. **[Medium]** Add try-catch around span operations for graceful degradation
5. **[Medium]** Remove unused `callIndex` or use it as a span attribute
6. **[Medium]** Add unit tests for `LangfuseService`
7. **[Low]** Consider adding `endConversation()` for explicit cleanup

---

## Unresolved Questions

1. Does `@langfuse/langchain` `CallbackHandler` v5 capture OTel context at stream creation or per-chunk? This determines severity of issue #3.
2. Are there any other callers of `UnifiedLLMService` beyond `LearningAgentService` and `OnboardingService` that might pass unexpected metadata shapes?
3. What is the expected concurrency? If >10K concurrent conversations, the Map cap needs adjustment.
