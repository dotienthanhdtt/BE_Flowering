## Code Review — TTS Alibaba CosyVoice Fallback

**Verdict:** APPROVE_WITH_CHANGES
**Critical issues:** 0
**High issues:** 2
**Medium issues:** 4
**Score:** 8.4 / 10

The implementation closely follows the red-teamed plan. State machine, sync-throw catching, force-close races, format gating, inactivity timer, error sanitization, and per-stream attribution all match plan intent. Tests are thorough (52 new tests + 18 existing) and cover the race state machine well. Build clean; 70/70 specs pass.

The main gaps are observability: `tts.fallback_fired` and the planned `tts.fallback_aborted` are not actual Langfuse events — they're only logger lines, so RT-J's rate-alerting metric can't be wired to a dashboard as the plan intended. There's also a small provider-attribution gap in the gateway's `resolveProvider()` direct-passthrough branch.

---

### Critical Issues

None.

---

### High Issues

#### H1. `tts.fallback_fired` is a log line, not a Langfuse event (RT-J partial)
**File:** `src/modules/ai/providers/fallback-tts.stream-handle.ts:172-174`, `src/modules/ai/providers/fallback-tts.provider.ts:93`

Plan RT-J explicitly required `tts.fallback_fired` to be a Langfuse-aggregated counter event for rate-alerting (>10% fallback / 5min). Current implementation only does `this.logger.warn(\`tts.fallback_fired reason=${reason} ...\`)` — a stdout text line, not a structured Langfuse event. Dashboards keyed on Langfuse event names will report zero fires.

The handle has no Langfuse access, and the `onFallback` callback is wired to `this.logger.log(...)` inside `FallbackTtsProvider.openStream`, not to `TtsService.emitEvent`.

**Suggested fix:** extend the `onFallback` callback signature so the gateway can register it from `handleConnection`, and inside the gateway call `this.tts.emitEvent(message.conversationId, 'tts.fallback_fired', { provider_primary, provider_secondary, reason })`. Or, inject `LangfuseService` into `FallbackTtsProvider` and emit directly (but the conversationId/traceId lives in the gateway, so wiring through the callback is cleaner).

#### H2. `tts.fallback_aborted` event missing entirely
**File:** `src/modules/ai/providers/fallback-tts.stream-handle.ts:157` (the format-unsupported branch fires `onFallback('format_unsupported', ...)`)

Plan Security Considerations (phase-03) and RT-A required:
> Format-incompatibility abort path emits `tts.fallback_aborted` for ops visibility (distinct from fallback_fired so dashboards can separate "fallback worked" vs "fallback refused").

`grep -r "fallback_aborted" src/` returns nothing. Both `fired` and `aborted` collapse into one `logger.log(\`Fallback signal: reason=...\`)` line in the provider. Dashboards cannot distinguish "fallback worked" from "fallback refused".

**Suggested fix:** route the `format_unsupported` reason through the same gateway-emitter introduced for H1, but under event name `tts.fallback_aborted`. The reason enum already carries the discriminator.

---

### Medium Issues

#### M1. `resolveProvider()` reports `'tts-fallback'` for direct-passthrough handles (attribution wrong)
**File:** `src/modules/ai/speech/tts.gateway.ts:69-73`

```ts
private resolveProvider(handle: TtsStreamHandle | undefined): string {
  if (!handle) return 'pending';
  if (handle instanceof FallbackTtsStreamHandle) return handle.getWinnerProvider();
  return this.ttsProvider.name;  // returns 'tts-fallback'
}
```

When `FallbackTtsProvider.openStream` returns `this.primary.openStream(opts)` directly (secondary unavailable / fallback disabled / format-unsupported branch), the handle is a `SonioxTtsStreamHandle`. `resolveProvider` then reports `'tts-fallback'` — a wrapper name no producer will recognise. Should be `'soniox'` (or `'alibaba-cosyvoice'` for the secondary-only branch).

**Suggested fix:** drop the `this.ttsProvider.name` branch in favour of returning `this.ttsProvider.primary.name` or, better, expose `getWinnerProvider()` on a base shape so the gateway never reaches the fallback branch. Cheap interim fix: return `'soniox'` (since direct passthrough only happens when secondary is unavailable or fallback disabled — in both cases primary is the actual producer).

#### M2. `FallbackTtsProvider.synthesize` doesn't gate primary on format support
**File:** `src/modules/ai/providers/fallback-tts.provider.ts:67-95`

`secondaryUsable` checks both `isAvailable()` AND `supportsFormat(fmt)`. `primaryUsable` only checks `isAvailable()`. If a future Soniox change drops support for a format the client requested, we'd silently call `primary.synthesize(text, {audioFormat: 'unsupported'})` and Soniox would either error or return wrong-format bytes. Asymmetric with the secondary path.

In practice both providers currently support `mp3 | wav | pcm_s16le`, so no live failure — but the asymmetry is a hidden trap.

**Suggested fix:** add `supportsFormat` to `SonioxTtsProvider` and check it in `primaryUsable` too. Same for `openStream` decision tree at lines 105-117.

#### M3. `getWinnerProvider()` returns `'pending'` even after stream ended in no-secondary error path
**File:** `src/modules/ai/providers/fallback-tts.stream-handle.ts:58-62, 101-105`

In the primary sync-throw path with no secondary configured, `winner` stays `null`, `finish(false)` runs, but `getWinnerProvider()` still returns `'pending'`. Cache won't persist (completed=false), so no concrete data corruption, but downstream Langfuse `tts.error` event will record `provider:'pending'` — misleading. Should record `primary.name` since that's the failing producer.

Same applies if primary errors and `secondary === null` (line 144).

**Suggested fix:** in both no-secondary branches, set `this.winner = 'primary'` before `finish(false)` so attribution is consistent. (Or introduce a `'primary-failed'` sentinel.)

#### M4. `start(text)` post-`forceClose()` not guarded
**File:** `src/modules/ai/providers/fallback-tts.stream-handle.ts:77-86`

```ts
start(text: string): void {
  this.pendingText = text;
  if (this.winner === 'secondary' && this.secondaryHandle) {
    this.secondaryHandle.start(text);
    return;
  }
  this.primaryHandle?.start(text);
}
```

If `forceClose()` ran first, `this.forced=true` but `start()` still proceeds — calls `primaryHandle.start(text)` on a closed handle (or `secondaryHandle.start(text)`). Underlying handles likely no-op since their WS is closed, but defensively this should early-return on `this.forced` or `this.ended`. Low-risk in practice.

---

### Plan-Fidelity Check
- [x] **[RT-A]** Format plumbing — `pcm_s16le → pcm` normalization in `normalizeFormat()`, `supportsFormat()` exposed on both Alibaba (provider+handle) and Fallback. Stream-handle pre-promotion check at line 152-166.
- [x] **[RT-B]** Sync-throw catch in wrapper constructor — `fallback-tts.stream-handle.ts:53-66` wraps `primary.openStream()` in try/catch; promotes immediately or fails fast if no secondary.
- [x] **[RT-C]** Per-stream `getWinnerProvider`, `cache_hit provider='cache'` — handle exposes per-instance `getWinnerProvider()`; `tts.service.ts:54-58` and `tts.gateway.ts:136-142` emit `provider: 'cache'`.
- [x] **[RT-D]** `onOpen` fires exactly once on winner determination — `openCbFired` flag in `fireOpenOnce()`; primary `onOpen` is intentionally a noop pre-race (line 125); secondary onAudio/onOpen both route through `fireOpenOnce()`.
- [x] **[RT-E]** `forceClose()` + `promoteToSecondary` guard against race leak — line 142 (`if (this.forced || this.winner !== null) return`) plus `clearTimeout(this.deadline)` in forceClose at line 92.
- [x] **[RT-F]** Inactivity timer on Alibaba handle — `resetInactivityTimer` at every inbound message + open; clearTimeout in `finish()` and `forceClose()`; `.unref?.()` set. Tests cover both expiry and reset.
- [x] **[RT-G]** `sanitizeMessage` scrubs Bearer + literal key — line 26-29 of stream-handle. Applied to task-failed, ws.on('error'). Spec explicitly asserts both substrings absent (alibaba-tts.provider.spec.ts:286-287).
- [x] **[RT-I]** `X-DashScope-DataInspection` opt-in only — header only set when `dataInspectionEnabled === true` (line 80-82). Default config is false. Spec covers both paths.
- [ ] **[RT-J]** `tts.fallback_fired` metric — **PARTIAL.** Implemented as `logger.warn` text only, not as a Langfuse structured event. Plan required aggregable metric for rate-alerting. See H1.
- [x] **[RT-K]** `AppConfiguration` interface updated + startup warning — fields added to interface; `FallbackTtsProvider` constructor logs error when `fallbackEnabled && !secondary.isAvailable()` (lines 41-45).
- [x] **[RT-M]** Concurrent streams test — `fallback-tts.provider.spec.ts:578-650` covers two simultaneous openStream calls, both promote independently.
- [x] **[RT-N]** Spec mock rename + `result.provider` assertion — `tts.service.spec.ts:47-51` renames `soniox` → `tts`, line 71 asserts `provider: 'soniox'`, line 122 asserts `cache_hit provider: 'cache'`.

Also worth noting:
- **`tts.fallback_aborted` event** — not emitted at all. See H2.
- **Dual-emit log keys** (RT-Assumption-6) — gateway lines 180-182, 203-204 emit both `soniox_*` and `tts_*` variants. ✓
- **Interface update** (RT-Assumption-1) — `audioFormat?` and `sampleRate?` added to `TtsStreamingProvider.openStream`. ✓
- **Constructor inline validation** of `audioFormat`/`sampleRate` (`alibaba-tts.stream-handle.ts:66-71`) — throws before WS open, caught in `AlibabaTtsProvider.synthesize` and converted to BadGatewayException. ✓
- **All setTimeout calls** use `.unref?.()` (alibaba handle line 229, fallback handle line 72, fallback provider line 141). ✓
- **No `as any` / `as never`** introduced in new code (one pre-existing `as never` at `tts.gateway.ts:388` is unchanged).
- **No API key in logs** — verified across all logger calls; only sanitized error messages cross the boundary.

---

### Suggested follow-ups (not blockers)

1. **Route `tts.fallback_fired` and `tts.fallback_aborted` through `LangfuseService.recordEvent`** via the gateway. Without this the RT-J alerting plan can't be implemented in dashboards. (See H1+H2.)
2. **Fix `resolveProvider` direct-passthrough attribution** (M1). One-line change but improves Langfuse attribution clarity.
3. **Add `SonioxTtsProvider.supportsFormat()`** for symmetric format gating in `FallbackTtsProvider.synthesize` (M2).
4. **Add explicit `winner` setting on no-secondary failure paths** (M3) so attribution is non-`'pending'` post-finish.
5. **Add `start()` early-return on `this.forced || this.ended`** (M4) — defensive.
6. **Inactivity timer 15s vs 3s fallback deadline**: a slow Alibaba could itself trigger primary-after-promotion errors (inactivity fires while gateway expects steady audio). Worth a smoke test confirming Alibaba's TTFB stays well under 15s in practice — the plan flagged this risk too.
7. **`AlibabaTtsStreamHandle.connect()`** doesn't wrap `new WebSocket(...)` in try/catch. If the `ws` library throws synchronously on header validation, `connect()` propagates — but the call sites (`buildHandle(...).connect()`) don't catch in `openStream` (line 129). That would bubble out of the wrapper. Probably fine since the wrapper's sync-throw branch handles it, but worth a defensive wrap.
8. **`session.timer` post-disconnect**: pre-existing — when client disconnects, the 60s MAX_DURATION timer keeps running, but session entry is deleted, so the timer's `cleanup(client)` is a noop and `session.handle.forceClose()` never runs. If upstream provider also stalls, the underlying TTS WS could leak for up to 60s. Not introduced by this PR; flag for a follow-up.

---

### Unresolved Questions

- Is the existing `logger.warn(\`tts.fallback_fired ...\`)` line being parsed by an external log shipper into a metric already? If yes, RT-J is partially satisfied. If no (more likely — Langfuse doesn't tail stdout), H1 stands as a blocker for the alerting story.
- Should the `tts.fallback_fired` event also be emitted by `FallbackTtsProvider.synthesize` (line 93) for the non-streaming path? Currently only the streaming path emits it via the handle. The synthesize path also "fired" but the only signal is a warn log.
