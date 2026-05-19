---
phase: 1
title: Fix C1 forceClose race
status: completed
priority: P1
effort: 30m
dependencies: []
---

# Phase 1: Fix C1 forceClose race

## Overview

`TtsGateway.finalizeStream` unconditionally calls `session.handle?.forceClose()` AFTER Alibaba already self-closed via `task-finished` (which already calls `ws.close(1000)` + `finish()`). The follow-up `ws.terminate()` races the in-flight close handshake → some node-ws versions emit a synthetic `'error'` event → `errorCb` fires → gateway emits spurious `tts.error` Langfuse event and calls `closeWithError` on an already-completed client.

## Root Cause

Dual lifecycle ownership: provider self-cleans on `task-finished`; gateway also force-closes on `finalizeStream`. The two paths overlap when provider completed cleanly.

## Fix Strategy (KISS)

Short-circuit `forceClose()` when the handle already finished. Implement at the **handle** level (single source of truth) rather than gateway (caller would have to know provider internals).

## Related Code Files

- Modify: `src/modules/ai/providers/alibaba-tts.stream-handle.ts`
- Modify: `src/modules/ai/providers/fallback-tts.stream-handle.ts` (symmetric guard)
- Modify: `src/modules/ai/providers/soniox-tts.provider.ts` (Soniox stream handle if it has a forceClose)
- Verify: `src/modules/ai/speech/tts.gateway.ts` `finalizeStream` — no caller change needed

## Implementation Steps

1. In `AlibabaTtsStreamHandle.forceClose()`: if `this.ended` is true, return early — do NOT call `ws.terminate()` again. The provider already cleaned up via `task-finished` path.
2. Also guard `clearTimeout(this.inactivityTimer)` to only run once (cheap idempotency).
3. Apply same `if (this.ended) return;` guard to `FallbackTtsStreamHandle.forceClose()` (defensive — wraps both providers; one may already be finished).
4. Check Soniox stream handle's `forceClose()` for the same pattern; add guard if missing.
5. Run `npm run build` to verify clean compile.
6. Run existing specs: `npm test -- alibaba-tts.provider fallback-tts.provider tts.service`.

## Success Criteria

- [ ] `AlibabaTtsStreamHandle.forceClose()` no-ops when `ended === true`
- [ ] `FallbackTtsStreamHandle.forceClose()` no-ops when already finished
- [ ] Soniox handle same guard (if applicable)
- [ ] Build clean
- [ ] Existing specs green
- [ ] New unit test: completed Alibaba stream → gateway `forceClose` → no `errorCb` fired

## Risk Assessment

Low. Idempotency guards are additive. Risk if `forceClose` ever needs to do additional cleanup beyond `ws.terminate()` — currently it does not.

## Verification

After fix, manually trigger a successful Alibaba stream and grep Langfuse events for `tts.error` on a happy-path message — should be absent.
