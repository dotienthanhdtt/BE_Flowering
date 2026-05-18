---
phase: 5
title: Tests
status: completed
priority: P2
effort: 4h
dependencies:
  - 4
---

# Phase 5: Tests

## Overview

Unit + integration coverage for service guards, provider, and controller. WS smoke deferred to manual (matches STT plan).

## Requirements
- No `.skip`. All tests pass.
- Soniox HTTP stubbed via `globalThis.fetch` spy.
- E2E uses existing test bootstrap.

## Test Matrix

| Layer | File | Cases |
|-------|------|-------|
| Provider | `soniox-tts.provider.spec.ts` | success returns Buffer + mp3 mime; 401 → BadGateway; missing API key → ServiceUnavailable |
| Service | `tts.service.spec.ts` | cache-hit short-circuits Soniox; scenario foreign user → 403; onboarding mismatched conversationId → 403; user-role message → 403; 5001-char → 400; happy path persists ttsAudioUrl |
| Controller (e2e) | `tts.controller.e2e-spec.ts` | scenario JWT required; onboarding public; response shape `{code:1, message, data:{audioUrl, mimeType}}` |
| Manual (WS) | (no automated spec) | wscat smoke: first chunk < 500ms; cache-hit path streams 1 chunk; foreign messageId closes 4403 |

## Related Code Files
- Create: `src/modules/ai/providers/soniox-tts.provider.spec.ts`
- Create: `src/modules/ai/speech/tts.service.spec.ts`
- Create: `test/tts.e2e-spec.ts`

## Implementation Steps
1. Provider unit: stub `globalThis.fetch` (jest.spyOn).
2. Service unit: in-memory repos + jest mocks for soniox/storage/langfuse.
3. E2E: existing test bootstrap pattern (see STT e2e specs for reference).
4. Run `npm test` + `npm run test:e2e`.

## Success Criteria
- [ ] `npm test` green.
- [ ] `npm run test:e2e` green.
- [ ] Coverage on new files ≥ 80%.
- [ ] Manual WS smoke documented in PR description with measured first-chunk ms.

## Risk Assessment
E2E test harness flakiness if Railway test DB unavailable. Skip e2e in CI when env missing (existing pattern).
