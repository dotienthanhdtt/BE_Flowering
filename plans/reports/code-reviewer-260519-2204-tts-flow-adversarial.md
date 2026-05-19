# Code Review — TTS Flow Adversarial (post-update commits)

**Scope:** `HEAD~5..HEAD` on `dev`. Re-review after the two `update` commits (69981cc, a2fc28e) that landed after the first reviewer report (`code-reviewer-260519-1026-tts-fallback.md`).

**Build:** `npm run build` clean.
**Prior verdict:** APPROVE_WITH_CHANGES. The two follow-up commits address most prior H/M findings — H1, H2, M1, M2, M3, M4 all show fixes in code. New issues focus on what the fixes don't cover (test gap) and new races opened by the post-completion `forceClose()` and the `ws.close(1000)` introduced in 69981cc.

---

## Stage 1 — Spec/Plan Compliance

| # | Requirement | Status | Evidence |
|---|---|---|---|
| RT-A format gate | ✅ | `alibaba-tts.provider.ts:52`, `fallback-tts.stream-handle.ts:197-223` |
| RT-B sync-throw | ✅ | `fallback-tts.stream-handle.ts:67-83` |
| RT-C per-stream attribution | ✅ | `getWinnerProvider()`; cache_hit=`'cache'` (`tts.service.ts:54-57`, `tts.gateway.ts:133`) |
| RT-D onOpen settles once | ✅ | `fireOpenOnce()`; primary onOpen is noop pre-race |
| RT-E forceClose race guard | ✅ | `forced=true` set first; `clearTimeout` on deadline |
| RT-F inactivity timer | ✅ | 15s; reset on every msg; `.unref?.()` |
| RT-G key scrubbing | ✅ | `sanitizeMessage` on task-failed + ws.error |
| RT-I DataInspection opt-in | ✅ | default false; header only when true |
| RT-J fallback_fired metric | ✅ (NEW) | `setEventListener` wired to `tts.emitEvent('tts.fallback_fired', ...)` in `tts.gateway.ts:163-173` |
| RT-K config interface + warn | ✅ | `app-configuration.ts:54`; boot warn at `fallback-tts.provider.ts:41-43` |
| `tts.fallback_aborted` | ✅ (NEW) | Emitted via same listener — `fallback-tts.stream-handle.ts:208-214` |
| `tts.synthesize` provider tag | ✅ | `tts.service.ts:75` reads `result.provider` |

No unjustified extras. New surface introduced by the two follow-ups is small and scoped: `ws.close(1000)` on Alibaba `task-finished` (lifecycle hygiene), `session.handle?.forceClose()` in `finalizeStream` (drain hygiene), and the `0x7FFFFFFF` WAV header sentinel (ExoPlayer fix).

---

## Stage 2 — Code Quality

| Aspect | Observation |
|---|---|
| File sizes | All under 300; gateway at 485 (pre-existing; not bloated by this PR — same as baseline) |
| Module DI registration | `AiModule` adds `AlibabaTtsProvider`, `FallbackTtsProvider` to `providers`; no entity changes — no `database.module.ts` update needed |
| Railway-safe deps | Only `ws` (already in deps from Soniox); no new npm package required |
| Response wrapper | TTS gateway is WS — bypasses HTTP interceptor; consistent with existing speech gateway |
| Raw exception leak | `closeWithError(client, 4500, 'provider', err.message)` (`tts.gateway.ts:250`) forwards provider error message verbatim to WS client — see I3 below |
| Secret hygiene | `apiKey` never logged; `sanitizeMessage` strips Bearer + key literal |

---

## Stage 3 — Adversarial Findings (NEW since prior review)

| # | Sev | File:line | Issue | Evidence | Fix |
|---|---|---|---|---|---|
| **C1** | Critical | `tts.gateway.ts:339-350` (NEW in 69981cc) | `finalizeStream` calls `session.handle?.forceClose()` AFTER `persistIfBuffered`. On the Alibaba path, `task-finished` already triggered `ws.close(1000)` + `finish()` → `endCb(true)` → this gateway `finalizeStream`. Calling `forceClose()` now invokes `ws.terminate()` on an already-closing socket AND calls `finish()` on the handle a second time — `finish()` is idempotent (guarded by `this.ended`), but the `ws.terminate()` racing the in-flight `close(1000)` handshake can cause an emit of `ws.on('error')` ("WebSocket was closed before the connection was established" or similar) on some node-ws versions. That fires `errorCb?.(...)` → `tts.gateway.ts:240-253` calls `closeWithError(client, 4500, 'provider', err.message)` **on the already-closed client** AND emits a spurious `tts.error` Langfuse event for a stream that completed successfully. Cache poisoning of error metrics. | `alibaba-tts.stream-handle.ts:129` closes WS; `tts.gateway.ts:347` then terminates it. Race window: between `ws.close(1000)` and node-ws emitting `'close'`. | Guard with `if (session.providerCompleted)` skip the force-close, OR add a `closed` flag in `AlibabaTtsStreamHandle.forceClose()` to short-circuit when `this.ended` is already true and skip `ws.terminate()`. Or: in gateway, only call `forceClose()` when `!session.providerCompleted` (handle already cleaned up itself on completion). |
| **I1** | Important | `fallback-tts.provider.spec.ts` (entire file) | No test coverage for the new `setEventListener` Langfuse emission path. The prior review's H1+H2 fix is the entire point of the post-review commit set, and there is zero unit test asserting `eventListener` is invoked with `type: 'tts.fallback_fired'` or `'tts.fallback_aborted'`. `grep -n setEventListener|eventListener` in spec returns 0 hits. Only the legacy `logger.warn('tts.fallback_fired ...')` is asserted (line 177). If the listener wiring breaks in a future refactor, dashboards silently stop receiving fallback events and no test catches it. | `grep` confirms. | Add 2 tests: (a) timeout path → listener called with `{type:'tts.fallback_fired', reason:'timeout', primary:'soniox', secondary:'alibaba-cosyvoice'}`; (b) format-unsupported path → listener called with `{type:'tts.fallback_aborted', reason:'format_unsupported', requestedFormat:'opus'}`. |
| **I2** | Important | `fallback-tts.stream-handle.ts:153-176` | Secondary handle's `onError` after promotion forwards the error to consumer (line 263), but the wrapper does NOT call `finish(false)`. If Alibaba errors mid-stream after winning the race, `errorCb` fires, then the underlying handle's `onEnd(false)` fires (because Alibaba calls `this.finish()` after `errorCb` in `task-failed` branch → `alibaba-tts.stream-handle.ts:139-140`), which then triggers `wireSecondaryCallbacks` `h.onEnd → this.finish(false)`. OK — but if a future provider impl errors without firing `onEnd`, the wrapper hangs forever. Primary path has the same shape (line 175 just calls `errorCb`, relies on `onEnd`). | Code path: error path relies on provider also firing `onEnd`. Soniox + Alibaba both do (verified), but the contract is implicit. | Either (a) document in `TtsStreamHandle` interface that `onError` must be followed by `onEnd`, OR (b) defensively call `this.finish(false)` after forwarding the error in both wirePrimary/wireSecondary onError. Belt-and-braces; cheap. |
| **I3** | Important | `tts.gateway.ts:240-253` | `closeWithError(client, 4500, 'provider', err.message)` forwards raw provider error text to the WS client as the close reason. Soniox/Alibaba errors are pre-sanitized for API keys, BUT the `withTimeout`-rejected primary in `FallbackTtsProvider.synthesize` (line 159) produces `"Primary synth timeout after 5000ms"` — fine — and Alibaba's `task-failed` carries `error_code: error_message` from upstream. If Alibaba ever returns a message that contains an internal hostname, request ID, or upstream provider name (DashScope's internal models leak in some error codes), it crosses to the client unredacted. Plus `closeWithError` truncates to 100 chars at line 469 — not enough sanitization, just truncation. | `tts.gateway.ts:250` `err.message`. | Slice to 80 chars AND replace with a generic `'TTS provider unavailable'` for client-visible reason; log the full sanitized text server-side only. Same fix the prior `AllExceptionsFilter` applies to HTTP responses. |
| **I4** | Important | `fallback-tts.stream-handle.ts:88` | Deadline timer fires `promoteToSecondary('timeout')` — but if `connect()` was called and primary handle's `openStream` returned a handle whose `onAudio` was synchronously invoked WITHIN the same tick (e.g. a cached-data provider), the audio arrives BEFORE wirePrimaryCallbacks attaches its listener at line 84. Result: audio is lost, deadline still fires, secondary promoted, primary's already-emitted chunk discarded. | `connect()`: `primaryHandle = primary.openStream(opts)` (line 68) → if openStream itself emits, callback is undefined. Currently primary handles defer audio to async WS events, so unlikely in practice — but the contract isn't enforced. | Attach `wirePrimaryCallbacks` BEFORE calling `primary.openStream()`. Pattern: construct handle then connect, like Alibaba does (`buildHandle(...).connect()`). Soniox's `.connect()` is currently fused with openStream. Easier interim fix: document that providers MUST NOT emit audio before the next tick. |
| **I5** | Important | `alibaba-tts.stream-handle.ts:120-134` (NEW in 69981cc) | `task-finished` calls `ws.close(1000)` then `finish()`. The `ws.on('close')` handler (line 156-159) ALSO calls `this.finish()`. `finish()` is `ended`-guarded so idempotent for `endCb`, BUT `clearTimeout(this.inactivityTimer)` runs once and is fine. The risk is timer ordering: `ws.close(1000)` triggers an async `'close'` event. Between `task-finished` running `finish()` and the `'close'` event firing, anything that resets `ended=false` would re-fire. Currently no such path — but if forceClose is called between (e.g. gateway's new `finalizeStream` force-close at line 347), `terminate()` may fire `'close'` event AFTER `finish()` already ran, which is harmless. Confirmed safe under current code BUT the dual-finish-path is a footgun. | Two paths call `finish()` for task-finished: synchronous (line 133) and async ws-close (line 158). | Remove the explicit `this.finish()` at line 133; let `ws.on('close')` handle it. The reason it was added (lifecycle symmetry) is preserved because `ws.close(1000)` always emits 'close'. Saves the dual-path. |
| **I6** | Important | `fallback-tts.provider.ts:99-114` | `withTimeout(primary.synthesize, 5000ms)` then on timeout calls `secondary.synthesize`. The primary's underlying HTTP request to Soniox REST is NOT cancelled — `fetch()` keeps running, the response is discarded silently when it eventually resolves. Resource leak: under sustained Soniox slowness, each request leaks one in-flight fetch + Soniox bills both. Same concern raised in plan §J ("Double-send during fallback") but only addressed for the streaming path. | `withTimeout` swallows the late resolution: `p.then(v => ...)` resolves after timer fires, ignored. The HTTP socket is held until response. | Pass an `AbortController` into `primary.synthesize`. Soniox provider's `fetch` already accepts a signal via opts — extend `TtsOptions` with `signal?: AbortSignal` and abort on timeout. |
| **M1** | Minor | `tts.gateway.ts:67-71` | `resolveProvider` returns `this.ttsProvider.primaryName` for non-FallbackTtsStreamHandle. In direct-passthrough where `!primaryUsable && secondaryUsable` (line 133-135 of fallback provider), the secondary handle is returned — but `resolveProvider` reports `primaryName='soniox'`. Wrong attribution. | Fallback provider `openStream` returns `this.secondary.openStream(opts)` when primary unavailable. Gateway sees a `SonioxTtsStreamHandle`-shaped object — no, actually an `AlibabaTtsStreamHandle` — but instanceof check is for `FallbackTtsStreamHandle` only, so falls through to `primaryName`. Reports `soniox` for Alibaba audio. | Track which path was taken. Either: have `FallbackTtsProvider.openStream` always return a `FallbackTtsStreamHandle` (with pre-settled winner for direct-passthrough), OR expose a discriminator on the returned handle. Cheap: in gateway, when `!primary.isAvailable()`, pass `secondaryName` instead. |
| **M2** | Minor | `fallback-tts.stream-handle.ts:166-168` | `h.onOpen?.(() => { /* noop pre-race */ })` overwrites any prior `onOpen` registration on primary. If a future Soniox change uses `onOpen` internally for state (currently it doesn't — only consumer-facing), this silently breaks. Defensive only. | Setter pattern; last write wins. | Document interface contract that callbacks are consumer-facing-only. |
| **M3** | Minor | `tts.gateway.ts:163-173` | `setEventListener` is wired only if `handle instanceof FallbackTtsStreamHandle`. In direct-passthrough (no race, just primary), the handle is `SonioxTtsStreamHandle` — no listener, but also no fallback events to emit, so OK. But if Soniox sync-throws inside `FallbackTtsProvider.openStream` AFTER format check passes, the `FallbackTtsStreamHandle.connect()` catches it and goes to fallback path. That handle DOES exist, gateway DOES set listener — but the gateway sets listener AFTER `openStream` returns, AFTER `connect()` ran, AFTER `queueMicrotask(() => promoteToSecondary(...))` was queued. Microtask runs synchronously before the next tick, but `setEventListener` runs synchronously after `openStream` returns — order: openStream → setEventListener → microtask flush → promoteToSecondary → eventListener?.({...}). OK, listener IS set first. Verified safe. | Microtask scheduling. | None — leave as-is, but add comment noting the ordering invariant. |
| **M4** | Minor | `alibaba-tts.provider.ts:70-129` | `synthesize()` Promise constructor does NOT handle the case where `handle.connect()` throws (line 126). If `ws` lib throws synchronously on bad URL/headers, the rejection escapes the Promise and bubbles up as an unhandled rejection. Currently no such throw exists in node-ws for the URL+headers we send, but adding `try { handle.connect(); handle.start(text); } catch (e) { settle(() => reject(...)) }` is cheap. | Lines 126-128. | Wrap in try/catch inside the Promise executor. |
| **M5** | Minor | `fallback-tts.stream-handle.ts:104` | `this.primaryHandle?.start(text)` runs even if `winner='primary'` has settled. Fine — `start()` on primary is idempotent (Soniox sets `pendingText` if not opened, else sends). But if winner is `null` AND deadline already fired the microtask to promote (in flight), `pendingText` is set on `FallbackTtsStreamHandle`, then `promoteToSecondary` reads `pendingText` and replays. Double-send avoided because primary's pendingText already consumed by Soniox onOpen. Verified safe. | — | None. |

---

## Concurrency / Singleton State Check

- `FallbackTtsProvider` is a Nest singleton. State held in instance fields: `primary`, `secondary`, `fallbackEnabled`, `timeoutMs`, `defaultFormat` — all configured-at-construction, never mutated. ✅
- `AlibabaTtsProvider` singleton state: `apiKey`, `model`, `voice`, ..., `inactivityTimeoutMs` — all readonly post-construction. ✅
- Per-stream state lives on `AlibabaTtsStreamHandle` / `FallbackTtsStreamHandle` instances — one per call. ✅
- Gateway uses `WeakMap<WebSocket, ActiveSession>` — no shared state across clients. ✅
- No `_lastWinner`-style cross-stream attribution leak (RT-C fully addressed).

---

## Test Quality

- `tts.service.spec.ts`: mock renamed `soniox`→`tts`, asserts `provider:'soniox'` and `cache_hit provider:'cache'`. ✅
- `fallback-tts.provider.spec.ts`: 922 lines, covers race state machine — timeout, error, sync-throw, forceClose, no-secondary, format-unsupported. **Gap: no test for `setEventListener` (I1).**
- `alibaba-tts.provider.spec.ts`: 521 lines, covers WS lifecycle, inactivity timer, sanitization, DataInspection opt-in.
- Timer usage: `jest.useFakeTimers()` + `jest.advanceTimersByTime(3001)` — deterministic, no real sleeps.
- No mock-only theater detected — handles are constructed and driven via real callback invocation.

---

## Verdict: **FIX_BEFORE_SHIP**

**Blocking:** C1 (spurious post-completion error emission). Fix is one conditional in `finalizeStream` or `forceClose`.

**Should-fix before merge:** I1 (test for the new Langfuse path), I3 (sanitize error message to client), I6 (abort leaked primary fetch on synth-path timeout).

**Defer:** I2, I4, I5, M1-M5 — file followups or address in v2.

---

## Unresolved Questions

1. **C1 reproduction:** does `ws.terminate()` after `ws.close(1000)` actually emit a synthetic `'error'` event in node-ws v8.x? If never (only emits `'close'`), C1 downgrades to Minor. Worth a quick local test: `node -e "const W=require('ws'); ..."`.
2. **I3 threat model:** does Alibaba CosyVoice `error_message` payload ever contain internal infrastructure identifiers? If pre-sanitized by Alibaba itself, current behavior is acceptable. Worth checking with a forced bad-voice request in dev.
3. **I6 vs YAGNI:** is the "Soniox slow but eventually responds" scenario rare enough to defer? Plan §J accepted the double-bill for streaming path explicitly. Consistent treatment of synth path likely also acceptable for v1.
4. **M1:** the direct-passthrough secondary-only branch is an unusual config (primary disabled, secondary enabled). Is it intentional support or accidental? If accidental, simpler to require both providers configured.

**Status:** DONE_WITH_CONCERNS
**Summary:** Post-update review found 1 Critical (post-completion error race), 6 Important (test gap on new Langfuse path, client error leak, fetch leak, listener ordering, dual-finish footgun, attribution edge case), 5 Minor. Prior H1/H2/M1-M4 are addressed; C1 is a NEW regression introduced by the lifecycle-cleanup commits.
**Concerns:** Recommend not shipping until C1 is verified (quick local repro test) and I1 test coverage is added — without it, regressions in the Langfuse wiring are silent.
