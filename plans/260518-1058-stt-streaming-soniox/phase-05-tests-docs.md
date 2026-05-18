---
phase: 5
title: "Tests & Docs"
status: complete
priority: P2
effort: "3h"
dependencies: [4]
completedDate: "2026-05-18T11:27:00.000Z"
---

# Phase 5: Tests & Docs

## Overview
Lock the feature with focused unit/integration tests and a short docs update describing the WS contract for the mobile team. No coverage maximalism — test the surfaces that matter (provider stream handling, gateway lifecycle, archival path, traceId pass-through).

## Requirements
- Functional:
  - Unit: `SonioxSttProvider` with mock ws server.
  - Unit: `AudioPcmBuffer` (cap enforcement, WAV header correctness).
  - Integration: `SpeechGateway` happy path + error paths via a real `ws` client against `INestApplication`.
  - Unit: chat DTO accepts `traceId`; service forwards it.
  - Docs: `docs/api-documentation.md` section for WS STT endpoint; `docs/system-architecture.md` mini-diagram.
- Non-functional:
  - `npm test` and `npm run build` pass on CI.

## Architecture
Use NestJS testing utilities (`Test.createTestingModule`) + raw `ws` client to drive the gateway. Mock Soniox with a local `ws` server bound to ephemeral port, inject URL via env.

## Related Code Files
- Create: `src/modules/ai/speech/audio-pcm-buffer.spec.ts`
- Create: `src/modules/ai/speech/speech.gateway.spec.ts`
- Create: `src/modules/ai/providers/soniox-stt.provider.spec.ts` (if not done in phase 1)
- Modify: `docs/api-documentation.md`
- Modify: `docs/system-architecture.md`
- Modify: `docs/codebase-summary.md` (add speech module bullet)
- Modify: `docs/project-changelog.md` (add entry)

## Implementation Steps
1. `AudioPcmBuffer` tests:
   - `push` accepts chunks up to cap.
   - `push` throws past cap.
   - `toWav` produces valid 44-byte RIFF header (sampleRate=16000, ch=1, bps=16) followed by raw PCM.
2. `SonioxSttProvider` tests:
   - Start mock ws server in `beforeEach`; capture incoming JSON config + binary frames.
   - Verify config payload (model, sample_rate=16000, num_channels=1, language).
   - Send fake token stream → assert `partial` then `final` callbacks fire with expected text.
   - `end()` resolves after final received; ws closes; `onClose` invoked.
   - Error: provider ws emits `error` → `onError` invoked with `Error`.
3. `SpeechGateway` integration:
   - Boot full Nest app with mocked `SonioxSttProvider` (use a fake `SttStreamingProvider` so we don't depend on real Soniox).
   - Scenario JWT path: connect with valid token → push PCM → receive partial+final → send `{type:'end'}` → receive `session_end` with `audioUrl` (mock storage returns fake URL).
   - Onboarding path: connect with valid sessionId.
   - Auth fail → close 4401.
   - Concurrent connect → second closes 4429.
   - Overflow simulation → close 4413.
   - Max duration via faked timer → close 4408.
4. Chat DTO + service tests:
   - DTO validation: invalid uuid rejected, valid uuid accepted.
   - Service: when `traceId` provided, CallbackHandler is instantiated with that id (assert with spy/mock).
5. Docs:
   - `api-documentation.md` — new section "WebSocket: /ws/speech/stt" with query params, message shapes, close codes, example sequence.
   - `system-architecture.md` — short mermaid diagram of mobile ↔ gateway ↔ Soniox + bucket.
   - `codebase-summary.md` — add bullet under AI module.
   - `project-changelog.md` — entry: "Added streaming STT (Soniox) gateway with Langfuse trace continuity and Railway audio archive."
6. Run `npm test`, `npm run lint`, `npm run build`. All clean.

## Success Criteria
- [x] All new spec files pass
- [x] `npm test` green for full suite
- [x] `npm run build` clean
- [x] `npm run lint` clean
- [x] Docs updated and cross-referenced
- [x] Single voice turn in Langfuse demonstrates `stt.session` + `llm.completion` in one trace

## Risk Assessment
- Gateway integration test flakiness from real ws timing → use deterministic mock provider, control timing with explicit promises (no `setTimeout` race).
- Mock storage service may diverge from real `ObjectStorageService` signature → use real instance with overridden `uploadAudio` returning fake URL.
- CI Node version difference (ws binding) → ensure tests use ephemeral port (`server.listen(0)`).

## Unresolved Questions
- Should we add a Postman/HTTPie example for the WS contract in `docs/`? (yes — small snippet using `wscat`).
- Audio retention TTL on Railway bucket — out of scope; revisit when storage cost matters.
