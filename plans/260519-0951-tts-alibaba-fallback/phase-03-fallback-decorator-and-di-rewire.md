---
phase: 3
title: "Fallback decorator and DI rewire"
status: pending
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: Fallback decorator and DI rewire

## Overview

Create `FallbackTtsProvider` (decorator wrapping Soniox + Alibaba). Rewire DI in `AiModule`, `TtsService`, and `TtsGateway` so the consumer field `soniox: SonioxTtsProvider` becomes `tts: FallbackTtsProvider`. **[RT-Assumption-1]** Update the `TtsStreamingProvider` interface to include `audioFormat?` and `sampleRate?` in `openStream` opts (currently widened locally by Soniox; gateway already passes them at gateway.ts:148-149).

This is the phase that actually flips the behavior. After this, real users get fallback automatically.

## Requirements

- Functional:
  - `openStream()` races Soniox vs 3s first-audio deadline. Winner = whichever provider emits first audio. On Soniox loss → silently switch to Alibaba; consumer sees one stream.
  - **[RT-A]** Before promoting to secondary, FallbackTtsProvider checks `secondary.supportsFormat(opts.audioFormat)`. If secondary cannot serve the requested format (e.g. client asked `pcm_s16le` but Alibaba only configured for mp3), abort promotion and surface Soniox's error to client. This prevents the cache-poisoning scenario where gateway prepends a PCM RIFF header to mp3 bytes.
  - **[RT-B]** Constructing `FallbackTtsStreamHandle` wraps `primary.openStream()` in try/catch. Synchronous throws from Soniox (e.g. `ServiceUnavailableException` when key missing at soniox-tts.provider.ts:257) → immediately promote to secondary without consuming the 3s deadline.
  - `synthesize()` tries Soniox with 5s overall timeout; on throw OR timeout → Alibaba.
  - **[RT-C]** Per-stream provider attribution: `FallbackTtsStreamHandle` exposes `getWinnerProvider(): string` once race settles. Gateway reads from handle, NOT from `this.tts.name` (which would be a singleton field race-conditioned across concurrent streams). For cache events, emit `provider: 'cache'` instead of inferring — the cached bytes' real origin is unknowable without a DB column (out of scope here).
  - **[RT-D]** `onOpen` contract: fires exactly once when winner is determined (i.e. on first audio chunk from primary, OR on secondary's `onOpen` after promotion). Gateway's `stream_ws_open` metric reads provider via `getWinnerProvider()` from event payload.
  - **[RT-J]** Every fallback fire emits a counter event (`tts.fallback_fired`) → Langfuse aggregated metric. Alert threshold: >10% fallback rate over 5min rolling window. Documented runbook: investigate Soniox health first, then Alibaba.
  - `defaultMimeType` / `configuredSampleRate` delegate to primary (Soniox). Both providers configured identical at env level (`mp3 @ 24000`), and per-request overrides plumbed via opts.
  - `isAvailable()` returns true if EITHER provider available; if Soniox unavailable → Alibaba used directly (no 3s wait).
- Non-functional:
  - File ≤200 lines (likely splits into `fallback-tts.provider.ts` + `fallback-tts.stream-handle.ts`).
  - **[RT-Assumption-1]** Interface change: `TtsStreamingProvider.openStream` opts gains `audioFormat?: string` and `sampleRate?: number`. Soniox provider already widens locally — narrowing into interface is safe.

## Architecture

### Streaming race state machine

```
State: RACING
  ├─ Soniox first audio chunk received (within 3s) → WINNER=soniox
  │    └─ forward all subsequent Soniox callbacks; close not-yet-opened Alibaba (none yet)
  ├─ Soniox onError fires → WINNER=alibaba
  │    └─ terminate Soniox; open Alibaba; forward Alibaba callbacks
  └─ 3s deadline elapses with no audio → WINNER=alibaba
       └─ terminate Soniox; open Alibaba; forward Alibaba callbacks
State: SETTLED(winner)
  └─ all callbacks passthrough; mid-stream errors surface unchanged
```

Consumer `onOpen` fires when winner provider's onOpen fires. Consumer `start(text)` buffered as `pendingText` and replayed to winner on settlement.

### File layout

```
src/modules/ai/providers/
  fallback-tts.provider.ts          # NEW — outer @Injectable wrapper
  fallback-tts.stream-handle.ts     # NEW — race state machine
```

### DI rewire

```ts
// ai.module.ts: add to providers array
SonioxTtsProvider,           // existing
AlibabaTtsProvider,          // NEW
FallbackTtsProvider,         // NEW
```

```ts
// tts.service.ts: rename injected field
constructor(
  private readonly tts: FallbackTtsProvider,   // was: soniox: SonioxTtsProvider
  ...
)
// replace `this.soniox.X` → `this.tts.X` (4 sites)

// tts.gateway.ts: rename injected field
constructor(
  private readonly tts: FallbackTtsProvider,   // was: soniox: SonioxTtsProvider
  ...
)
// replace `this.soniox.X` → `this.tts.X` (8+ sites)
// adjust local var names `tSonioxOpen` → `tTtsOpen` and log strings where they say "Soniox"
```

## Related Code Files

- Create: `src/modules/ai/providers/fallback-tts.provider.ts`
- Create: `src/modules/ai/providers/fallback-tts.stream-handle.ts`
- Modify: **[RT-Assumption-1]** `src/modules/ai/providers/tts-provider.interface.ts` (add `audioFormat?`, `sampleRate?` to openStream opts; add `supportsFormat()` to `TtsStreamingProvider`; add `provider?: string` to `TtsResult`)
- Modify: `src/modules/ai/ai.module.ts` (add 2 providers to array)
- Modify: `src/modules/ai/speech/tts.service.ts` (rename field + reference rewrite + provider attribution change)
- Modify: `src/modules/ai/speech/tts.gateway.ts` (rename field + 8+ references + dual-emit log keys + provider attribution from handle)

## Implementation Steps

0. **[RT-Assumption-1]** Update `tts-provider.interface.ts:38`:
   ```ts
   openStream(opts: {
     language?: string;
     voice?: string;
     traceId: string;
     audioFormat?: string;     // NEW
     sampleRate?: number;      // NEW
   }): TtsStreamHandle;
   ```
   This makes Soniox's local widening + gateway's existing call-shape (gateway.ts:148-149) compile-checked.

1. **Create `fallback-tts.stream-handle.ts`** implementing `TtsStreamHandle`:
   - Constructor: `primary: TtsStreamingProvider`, `secondary: TtsStreamingProvider | null`, `openOpts`, `timeoutMs`, `logger`.
   - Fields: `winner: 'primary'|'secondary'|null=null`, `primaryHandle?`, `secondaryHandle?`, `pendingText`, `deadline?: NodeJS.Timeout`, callback refs, `forced=false`, `openCbFired=false`.
   - **[RT-B]** On instantiate: wrap `primary.openStream(opts)` in try/catch.
     - On synchronous throw: log `tts.fallback_fired reason=primary_sync_throw`; if `secondary` null → re-throw; else immediately set `winner='secondary'` and open secondary directly (skip race timer).
   - Otherwise, store `primaryHandle`, start `setTimeout(promoteToSecondary, timeoutMs)` (only if secondary available).
   - Wire primary callbacks:
     - `onAudio(chunk)`: if `winner==null && !forced` → set `winner='primary'`, clearTimeout, fire consumer `openCb()` (once, via `openCbFired` flag) **[RT-D]**, then forward chunk; else passthrough (if winner==='secondary' or forced → absorb).
     - `onOpen()`: if `winner==null` → note `primaryOpened=true` but do NOT settle and do NOT fire consumer onOpen yet (first audio settles). **[RT-D]** Consumer onOpen waits for winner determination.
     - `onError(err)`: if `winner==null && !forced` → `promoteToSecondary('error')`; else passthrough.
     - `onEnd(completed)`: if `winner==='primary'` → forward; else absorb silently.
   - `start(text)`:
     - Store as `pendingText`.
     - If `winner==='primary'` → already settled; pass through to `primaryHandle.start(text)`.
     - Else send to primary preemptively (its internal buffering takes over). On promotion, `pendingText` replays to secondary.
   - `promoteToSecondary(reason: 'error' | 'timeout' | 'primary_sync_throw' | 'format_unsupported')`:
     - **[RT-E]** Guard at top: `if (this.forced || this.winner !== null) return;`
     - **[RT-A]** Check `secondary.supportsFormat(openOpts.audioFormat ?? defaultFormat)`. If false: log `tts.fallback_aborted reason=format_unsupported requestedFormat=...`; forward original primary error (or synthesized error) via `errorCb`; `finish(false)`. DO NOT open secondary.
     - `winner='secondary'`; clearTimeout; `primaryHandle?.forceClose()`.
     - **[RT-J]** Log `tts.fallback_fired` with `reason` field; emit Langfuse counter event for rate-alerting.
     - **[RT-B/E]** Wrap `secondary.openStream(opts)` in try/catch. On throw → forward via `errorCb`, `finish(false)`.
     - **[RT-D]** Wire secondary callbacks: on first audio OR on `onOpen()` (whichever fires first), fire consumer `openCb()` once (via `openCbFired` flag).
     - If `pendingText != null` → call `secondaryHandle.start(pendingText)`.
   - **[RT-E]** `forceClose()`: `forced=true`; clearTimeout; close both handles if present; `finish(false)`.
   - **[RT-C]** `getWinnerProvider(): string` — returns `primary.name`, `secondary.name`, or `'pending'` based on `winner` field.
   - `onAudio/onEnd/onError/onOpen` setters: store callback refs.

2. **Create `fallback-tts.provider.ts`** `@Injectable()`:
   - Inject `SonioxTtsProvider`, `AlibabaTtsProvider`, `ConfigService`, `Logger`.
   - Read `ai.ttsFallbackEnabled`, `ai.ttsFallbackTimeoutMs`.
   - **[RT-C]** No `_lastWinner` singleton field. `name` getter is removed in favor of per-stream `getWinnerProvider()`. For non-streaming/synth path, `synthesize()` returns `{provider, audio, mimeType}` extended shape (`provider` field added to `TtsResult`).
   - `get defaultMimeType()` → `primary.defaultMimeType` (primary canonical).
   - `get configuredSampleRate()` → `primary.configuredSampleRate`.
   - `isAvailable()` → `primary.isAvailable() || secondary.isAvailable()`.
   - **[RT-K]** Constructor logs error if `ttsFallbackEnabled && !secondary.isAvailable()` (DashScope key missing despite fallback on).
   - `synthesize(text, opts)`:
     ```ts
     // [RT-A] capability check
     const fmt = opts?.audioFormat ?? this.config.alibabaTtsFormat;
     const secondaryUsable = secondary.isAvailable() && secondary.supportsFormat(fmt);
     if (!primary.isAvailable()) {
       if (!secondaryUsable) throw new ServiceUnavailableException();
       return tagProvider(await secondary.synthesize(text, opts), secondary.name);
     }
     if (!secondaryUsable || !fallbackEnabled) {
       return tagProvider(await primary.synthesize(text, opts), primary.name);
     }
     try {
       return tagProvider(await withTimeout(primary.synthesize(text, opts), 5000), primary.name);
     } catch (err) {
       logger.warn(`tts.fallback_fired (synth): ${sanitize(err.message)}`);
       return tagProvider(await secondary.synthesize(text, opts), secondary.name);
     }
     ```
     Where `tagProvider(result, name)` adds `provider: name` to the result.
   - `openStream(opts)`:
     - If only secondary available AND secondary usable → `secondary.openStream(opts)`.
     - If only primary available OR fallback disabled → `primary.openStream(opts)`.
     - **[RT-A]** If `opts.audioFormat` set AND `!secondary.supportsFormat(opts.audioFormat)` → return `primary.openStream(opts)` (no fallback path, Soniox-only).
     - Else → `new FallbackTtsStreamHandle(primary, secondary, opts, timeoutMs, logger)`.

3. **Rewire `ai.module.ts`**:
   - Import `AlibabaTtsProvider`, `FallbackTtsProvider`.
   - Add both to `providers: [...]` array (Soniox stays — it's a dependency of the wrapper).
   - No export changes; consumers still inject by class type.

4. **Rewire `tts.service.ts`**:
   - Replace `import { SonioxTtsProvider }` → `import { FallbackTtsProvider }`.
   - Constructor field: `soniox: SonioxTtsProvider` → `tts: FallbackTtsProvider`.
   - References to update:
     - `this.soniox.synthesize(...)` (line 60) → `this.tts.synthesize(...)`.
     - `this.soniox.defaultMimeType` (line 56) → `this.tts.defaultMimeType` (cache_hit path).
     - **[RT-C]** `provider: this.soniox.name` event attributes (line 54, 72) → `provider: result.provider` on synth result, OR `provider: 'cache'` on cache_hit. The cache_hit event MUST emit `'cache'` (not `'soniox'`/`'alibaba'`) because the actual provider that produced the cached bytes is unknowable post-hoc.
   - Update comment `// Cache hit → re-sign stored path → no Soniox call` to `// Cache hit → re-sign stored path → no TTS call`.

5. **Rewire `tts.gateway.ts`**:
   - Replace import + constructor field name.
   - **[RT-C]** Provider attribution rewire (8+ sites at lines 127, 145, 210, 223, 330, 343, 363):
     - On cache_hit (line 127): emit `provider: 'cache'`.
     - On `tts.stream_open` (line 223): emit `provider: 'pending'` (race not yet settled).
     - **[RT-D]** On `tts.stream_ws_open` (line 153): bind `handle.getWinnerProvider()` only if winner set; else `'pending'`.
     - On `tts.first_chunk` (after winner settles): emit `provider: handle.getWinnerProvider()`.
     - On `tts.synthesize` finalization (line 330, 343): emit `provider: handle.getWinnerProvider()`.
     - On error events (line 210, 363): emit `provider: handle.getWinnerProvider()` or `'pending'`.
   - Rename local vars `tSonioxOpen` → `tTtsOpen` and add new log keys; **DO NOT silently rename existing keys that dashboards depend on**:
     - **[RT-Assumption-6]** Dual-emit during transition: keep `soniox_connect_ms`/`soniox_first_audio_ms` AS-IS, ALSO add `tts_connect_ms`/`tts_first_audio_ms` with same values. Document a 2-week deprecation window in CHANGELOG; flip dashboards to new keys; remove old keys in a follow-up PR.
   - Update log strings: "Soniox TTS WS error" → "TTS WS error"; "Failed to open Soniox TTS stream" → "Failed to open TTS stream".
   - Update comments referencing Soniox by name.

6. **Build check**: `npm run build` — zero TS errors. Lint check.

## Success Criteria

- [ ] `FallbackTtsProvider` injected wherever Soniox was; `TtsService` and `TtsGateway` reference `this.tts.X`.
- [ ] **[RT-Assumption-1]** `TtsStreamingProvider` interface includes `audioFormat?` + `sampleRate?` in openStream opts.
- [ ] **[RT-B]** Soniox sync throw from `openStream` → wrapper catches and promotes immediately (verified by spec).
- [ ] **[RT-A]** Format-incompatibility scenario (client `?format=wav`, Soniox down, Alibaba can't serve pcm_s16le if mis-config) → fallback aborts, Soniox error surfaces. Verified by spec.
- [ ] **[RT-C]** Provider attribution comes from `handle.getWinnerProvider()`, not from `this.tts.name`. No singleton `_lastWinner` field exists.
- [ ] **[RT-C]** Cache_hit event emits `provider: 'cache'`.
- [ ] **[RT-D]** Consumer `onOpen` fires exactly once when winner settles, not on every internal WS open.
- [ ] **[RT-E]** `forceClose()` during 3s race window prevents secondary from opening (no leaked WS, no DashScope token spend). Verified by spec.
- [ ] **[RT-J]** `tts.fallback_fired` metric emitted on every promotion with `reason` field; runbook documented.
- [ ] **[RT-Assumption-6]** Dual-emit metric keys during transition (`soniox_*` + `tts_*`); deprecation window noted.
- [ ] `npm run build` passes.
- [ ] No references to `SonioxTtsProvider` outside of `ai.module.ts` providers array, `fallback-tts.provider.ts`, and the Soniox files themselves.
- [ ] `tts.synthesize` event includes correct `provider` attribute (`soniox` on happy path, `alibaba-cosyvoice` on fallback).
- [ ] When `DASHSCOPE_API_KEY` absent at boot, startup logs error and `isAvailable()` reflects state.

## Risk Assessment

- **[RT-C] Provider attribution under concurrency:** No singleton `_lastWinner` field. `getWinnerProvider()` is per-stream-handle. Concurrent streams have independent attribution. Cache_hit events emit `'cache'` — accepted lossy attribution (real provider unknowable without a DB column; tracked as v2 follow-up).
- **[RT-E] Stream-handle race condition with `forceClose()`:** Top-of-function guard in `promoteToSecondary` (`if (this.forced || this.winner !== null) return`) + `clearTimeout` inside `forceClose` prevents secondary from opening after force-close.
- **Soniox sends 1 audio chunk at 2.9s, then dies:** Counts as Soniox win. Mid-stream death surfaces as `onEnd(completed=false)` → not cached. Acceptable per brainstorm decision.
- **[RT-J] `pendingText` replay double-send + double-billing during fallback storms:** Soniox already received + processed text by the time the 3s deadline fires (Soniox sends on WS-open ~200ms). On every fallback we pay both providers. Mitigation: Langfuse counter for `tts.fallback_fired` rate with alert threshold; runbook for incident response. Re-evaluate after first real outage.
- **[RT-Assumption-6] Renaming observability log keys silently breaks dashboards:** Dual-emit `soniox_*` AND `tts_*` keys during 2-week transition. Document in CHANGELOG.
- **[RT-Assumption-7] Existing test mock false-green risk:** Phase 4 mandates explicit mock variable rename + wrapper-shape assertions to catch silent duck-typing pass.
- **8+ rename sites in gateway is error-prone:** Use grep + targeted `Edit` per file, not `replace_all` (risk of touching strings inside log messages we want to keep).

## Security Considerations

- No new auth surface; Alibaba key handled by Phase 2 (`sanitizeMessage` scrubs `Bearer\s+\S+` from forwarded errors).
- Logs never include either provider's API key.
- `tts.fallback_fired` event metadata = `reason` enum (`timeout` | `error` | `primary_sync_throw` | `format_unsupported`) — never full error stack.
- **[RT-A]** Format-incompatibility abort path emits `tts.fallback_aborted` for ops visibility (distinct from fallback_fired so dashboards can separate "fallback worked" vs "fallback refused").
