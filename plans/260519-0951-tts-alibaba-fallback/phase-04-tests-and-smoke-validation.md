---
phase: 4
title: "Tests and smoke validation"
status: pending
priority: P2
effort: "3h"
dependencies: [3]
---

# Phase 4: Tests and smoke validation

## Overview

Unit tests for `AlibabaTtsProvider` and `FallbackTtsProvider`. Integration smoke test against dev Railway with `DASHSCOPE_API_KEY` populated. Existing `tts.service.spec.ts` and `soniox-tts.provider.spec.ts` must still pass after the DI rewire.

## Requirements

- Functional:
  - Alibaba provider: WS mock asserts run-task/continue-task/finish-task sequence and binary frame handling.
  - Fallback provider: race state machine covered for happy path, timeout, error, force-close mid-race.
  - Existing TTS tests pass without modification (or with mechanical rename `soniox` → `tts`).
- Non-functional:
  - No real network calls in unit tests (mock `ws`).
  - Smoke test = manual checklist, not automated CI (no Alibaba account in CI env).

## Architecture

Reuse the mocking pattern from `soniox-tts.provider.spec.ts` (mock the `ws` module). For Fallback, inject mock primary/secondary providers and assert which `openStream` was called and when.

## Related Code Files

- Create: `src/modules/ai/providers/alibaba-tts.provider.spec.ts`
- Create: `src/modules/ai/providers/fallback-tts.provider.spec.ts`
- Modify (if needed): `src/modules/ai/speech/tts.service.spec.ts` (rename injection if test references `SonioxTtsProvider` directly)
- Read (reference): `src/modules/ai/providers/soniox-tts.provider.spec.ts`

## Implementation Steps

1. **AlibabaTtsProvider spec** — mock `ws`:
   - Happy path: open → run-task sent → server emits task-started → start(text) → continue-task sent → finish-task sent → binary frames → task-finished → `onEnd(true)` fires.
   - Buffering: `start(text)` before task-started → buffered, sent after event.
   - Error path: task-failed event → `onError` fires with code+message; `completedByProvider=false`.
   - Premature close: WS close before task-finished → `onEnd(false)`.
   - `isAvailable()` false when key absent.
   - `synthesize(text)` resolves with concatenated mp3 Buffer on happy path; rejects on error.
   - **[RT-A]** Format plumbing: `openStream({audioFormat: 'pcm_s16le', sampleRate: 24000})` → run-task payload has `parameters.format='pcm'` and `parameters.sample_rate=24000`. Constructor throws on unsupported format/sample-rate.
   - **[RT-A]** `supportsFormat('pcm_s16le')` returns true; `supportsFormat('flac')` returns false.
   - **[RT-F]** Inactivity timeout: fake timers; no message received for 15s → `errorCb('Alibaba TTS inactivity timeout')` + ws.terminate called.
   - **[RT-F]** Timer resets on each audio chunk — verify with 14s+chunk+14s pattern (no timeout fires).
   - **[RT-F]** `synthesize()` rejected case calls `forceClose()` in finally — ws.terminate invoked.
   - **[RT-G]** Error sanitization: simulate `task-failed` event with `error_message='auth failed for Bearer sk-xxx'` and `apiKey='sk-real'` configured → forwarded error.message contains neither `Bearer sk-xxx` nor `sk-real`.
   - **[RT-I]** With `alibabaDataInspectionEnabled=false` (default) → WS handshake headers do NOT include `X-DashScope-DataInspection`. With true → header present with value `enable`.

2. **FallbackTtsProvider spec** — inject mock Soniox + Alibaba:
   - Soniox emits audio in <3s → only Soniox.openStream called; Alibaba never opened.
   - Soniox emits onError before audio → Alibaba.openStream called immediately; `tts.fallback_fired` log present with `reason='error'`.
   - 3s deadline elapses with no audio → Alibaba.openStream called with `reason='timeout'`; primary handle force-closed.
   - **[RT-E]** `forceClose()` during race window (before deadline timer fires) → forced flag set; when deadline timer subsequently fires, `promoteToSecondary` guard returns early; secondary never opens; no dangling timer.
   - **[RT-E]** `forceClose()` called AFTER deadline fired but BEFORE secondary connect completes → secondary handle's `forceClose()` invoked; no leaked WS.
   - **[RT-B]** Soniox `openStream` throws synchronously (e.g. ServiceUnavailableException) → wrapper catches, immediately opens Alibaba, emits `tts.fallback_fired reason='primary_sync_throw'`. 3s timer never starts.
   - **[RT-A]** Client requests `audioFormat='pcm_s16le'`, Soniox times out, Alibaba `supportsFormat('pcm_s16le')` returns false → `tts.fallback_aborted reason='format_unsupported'` emitted; Soniox's error surfaces to consumer; Alibaba.openStream NEVER called.
   - **[RT-A]** Client requests `audioFormat='pcm_s16le'`, Soniox times out, Alibaba supports it → Alibaba.openStream called with `{audioFormat: 'pcm_s16le', sampleRate: 24000}` (opts plumbed through).
   - **[RT-C]** `handle.getWinnerProvider()` returns `'pending'` pre-race, `'soniox'` after Soniox wins, `'alibaba-cosyvoice'` after promotion.
   - **[RT-D]** Consumer `onOpen` callback fires exactly once on winner determination (not on every internal WS open). Verify with a counter and assertion.
   - **[RT-M]** **Concurrent streams test**: two `openStream()` calls in flight simultaneously, both promote to Alibaba, both fire `tts.fallback_fired` independently. Each handle's `getWinnerProvider()` returns correctly. No singleton state corruption.
   - Only Soniox available → no race timer; direct passthrough.
   - Only Alibaba available → direct passthrough to secondary, no Soniox attempt.
   - Both unavailable → `synthesize` throws ServiceUnavailableException; `openStream` throws.
   - `synthesize` happy path: Soniox resolves in <5s → Soniox result returned with `provider='soniox'`.
   - `synthesize` Soniox throws → Alibaba called, result returned with `provider='alibaba-cosyvoice'`, warn logged.
   - `synthesize` Soniox times out (mock 6s delay) → Alibaba called.
   - **[RT-A]** `synthesize` with `opts.audioFormat='pcm_s16le'`, Soniox throws, Alibaba doesn't support → ServiceUnavailableException re-thrown (Soniox's original error), Alibaba.synthesize NEVER called.
   - **[RT-J]** Verify `tts.fallback_fired` event payload includes `reason` enum (`timeout` | `error` | `primary_sync_throw`) and is emitted via the Langfuse-friendly path. (Actual rate-alerting threshold lives in dashboard config, not code.)

3. **Existing test updates**:
   - Run `npm test` after Phase 3 DI rewire.
   - **[RT-Assumption-7]** `tts.service.spec.ts` MUST rename mock variable `soniox` → `tts` AND add an explicit assertion that `result.provider` field is plumbed through. Duck-typing the old mock as `{name, defaultMimeType, synthesize}` against the new `FallbackTtsProvider` parameter type will silently pass — explicit assertion blocks false-green. Also assert cache_hit event emits `provider: 'cache'` (not `provider: 'soniox'`).
   - Update any `tts.gateway` tests that rely on `soniox_*` log keys: they remain valid during dual-emit window; add corresponding assertions on new `tts_*` keys.

4. **Smoke validation** (manual, in dev env):
   - Set `DASHSCOPE_API_KEY` on dev Railway service.
   - From Flutter app or curl: trigger a TTS request → confirm Soniox path works (default).
   - Temporarily set `SONIOX_API_KEY=invalid` on dev → trigger TTS → confirm audio still plays (Alibaba fallback).
   - Verify Langfuse trace has `tts.fallback_fired=true` event.
   - Restore `SONIOX_API_KEY`; verify Soniox path resumes.

5. **Build + lint**: `npm run build && npm run lint`.

## Success Criteria

- [ ] `npm test` passes (full suite).
- [ ] New specs cover all Alibaba scenarios + all fallback scenarios (incl. **[RT-A]** format gating, **[RT-B]** sync throw, **[RT-C]** per-stream attribution, **[RT-D]** onOpen-once, **[RT-E]** force-close race, **[RT-F]** inactivity timeout, **[RT-G]** key sanitization, **[RT-I]** conditional header, **[RT-J]** fallback_fired payload, **[RT-M]** concurrent streams).
- [ ] **[RT-Assumption-7]** `tts.service.spec.ts` mock variable renamed; explicit `result.provider` assertion added; `cache_hit provider='cache'` asserted.
- [ ] `npm run build` clean.
- [ ] Smoke test in dev confirms fallback fires under simulated Soniox outage.
- [ ] Smoke test verifies WAV path: `?format=wav` request with Soniox killed → either Alibaba serves pcm_s16le (if supported by chosen model variant) OR fallback aborts cleanly with non-corrupt error.
- [ ] Langfuse shows `provider:alibaba-cosyvoice` on synthesize event after fallback.

## Risk Assessment

- **Risk: Real `ws` library behavior diverges from mock.** Mitigation: smoke test catches this; mock follows the same callback contract Soniox spec uses.
- **Risk: Flaky 3s deadline test (timer-based).** Mitigation: use jest fake timers (`jest.useFakeTimers()`); advance with `jest.advanceTimersByTime(3001)`.
- **Risk: Smoke test pollutes prod cache with Alibaba audio under different voice.** Mitigation: dev-only smoke; per brainstorm decision, cache is single-key first-writer-wins anyway — acceptable.
- **Risk: Test files exceed 200-line limit.** Mitigation: split fallback spec into `fallback-tts.stream.spec.ts` + `fallback-tts.synthesize.spec.ts` if needed.

## Security Considerations

- Smoke test must not commit real `DASHSCOPE_API_KEY` to git (use Railway env vars or local `.env`).
- Mocked tests never call out to real Alibaba/Soniox endpoints.
