---
phase: 3
title: Sanitize client error + abort primary fetch
status: completed
priority: P2
effort: 1h
dependencies: []
---

# Phase 3: Sanitize client error + abort primary fetch

## Overview

Two related hardening fixes:

- **I3** — `tts.gateway.ts:240-253` forwards raw provider error message verbatim to WS client via `closeWithError(client, 4500, 'provider', err.message)`. Truncated to 100 chars but not sanitized. Alibaba `task-failed` payloads (DashScope error codes) may carry internal infrastructure identifiers.
- **I6** — `FallbackTtsProvider.synthesize` wraps primary via `withTimeout(5000ms)`. On timeout, primary's underlying `fetch()` is NOT cancelled — keeps running, response discarded, Soniox still bills. Under sustained slowness, leaks one in-flight socket per request.

## Related Code Files

- Modify: `src/modules/ai/speech/tts.gateway.ts` — sanitize client-visible reason
- Modify: `src/modules/ai/providers/fallback-tts.provider.ts` — wire AbortController into `withTimeout`
- Modify: `src/modules/ai/providers/tts-provider.interface.ts` — add `signal?: AbortSignal` to synth options
- Modify: `src/modules/ai/providers/soniox-tts.provider.ts` — accept and forward signal to `fetch`
- Modify: `src/modules/ai/providers/alibaba-tts.provider.ts` — accept signal (no-op for stream path or abort connect)

## Implementation Steps

### I3 — Sanitize client-visible error

1. In `tts.gateway.ts` `handle.onError(...)` block (~line 240-253): keep logging full sanitized `err.message` server-side, but pass a **generic** reason to `closeWithError`. Suggested: `closeWithError(client, 4500, 'provider', 'TTS provider unavailable')`.
2. Optionally include a short non-identifying category derived from error class (e.g. `'timeout' | 'unavailable' | 'format'`) — only if cheap.
3. Confirm `closeWithError` already truncates to 100 chars — keep as defense-in-depth.

### I6 — Abort primary fetch on timeout

1. Extend `TtsOptions` (or synth-specific opts type) in `tts-provider.interface.ts` with optional `signal?: AbortSignal`.
2. `SonioxTtsProvider.synthesize`: thread `opts.signal` into `fetch(url, { signal: opts.signal, ... })`.
3. `AlibabaTtsProvider.synthesize`: accept signal; if signal fires before WS opens, abort the WS connect + reject promise.
4. In `FallbackTtsProvider.withTimeout`: create `AbortController` per call, pass `controller.signal` to inner `primary.synthesize(text, { ...opts, signal })`, call `controller.abort()` when the timeout timer fires before resolving the rejection.
5. Cleanup: on success path, `clearTimeout` AND release controller (no abort).

### Validation

6. `npm run build` clean.
7. Run `npm test -- fallback-tts.provider soniox-tts alibaba-tts`.
8. Add unit test: primary synth times out → `AbortController.abort()` called → secondary completes → success.

## Success Criteria

- [ ] Client receives generic reason text, not raw provider message
- [ ] Server-side log still contains full sanitized error
- [ ] Primary fetch is aborted on synth-path timeout (verified by test or instrumented fetch mock)
- [ ] `TtsOptions.signal` optional and back-compatible (defaults to no abort)
- [ ] Build + all TTS specs green

## Risk Assessment

- Signature change ripples across 3 providers — keep `signal` optional to avoid breaking callers that don't pass one.
- Aborted fetch in Soniox may need a try/catch around the fetch call to convert `AbortError` into a clean rejection.

## Notes

- I3 fix is independent of I6 — can land separately if I6 grows in scope.
- Defer I2, I4, I5, M1–M5 per review verdict.
