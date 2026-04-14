# Phase 04 — Backend Tests

## Context Links

- Plan overview: `plan.md`
- Blockers: phases 01, 02, 03 complete
- Test files: `src/modules/onboarding/onboarding.controller.spec.ts`, `src/modules/onboarding/onboarding.service.spec.ts`

## Overview

- **Priority:** P1
- **Status:** completed
- **Brief:** Drop `/start` tests. Add `handleChat` unit tests (both branches + invalid combos). Update controller spec for merged endpoint.

## Key Insights

- `startSession` + `chat` now private — test only via `handleChat` and `complete`.
- DTO-level validation tests via `validate()` from `class-validator` to confirm `@ValidateIf` gates.
- Throttler guard not unit-tested (framework responsibility); integration test optional.

## Requirements

**Functional**
- Test creation branch (no convId) end-to-end through service mock.
- Test chat branch (with convId).
- Test missing languages + no convId → DTO validation error.
- Test invalid convId → 404.

**Non-functional**
- All existing passing tests remain green.
- No mocks of LLM beyond current pattern.

## Architecture

```
controller.spec → mock OnboardingService → assert handleChat called with DTO
service.spec    → mock repos + LLM → assert startSession+chat composed correctly
dto.spec (optional inline in service spec) → class-validator runs on plain payloads
```

## Related Code Files

**Modify**
- `src/modules/onboarding/onboarding.controller.spec.ts`
- `src/modules/onboarding/onboarding.service.spec.ts`

**Optional new**
- `src/modules/onboarding/dto/onboarding-chat.dto.spec.ts` — DTO validation matrix (consider if inline grows >50 lines)

## Implementation Steps

1. **Controller spec**
   - Remove `describe('start', ...)` block.
   - Update `describe('chat', ...)`:
     - Case A: `{nativeLanguage, targetLanguage}` → service.handleChat called once, returns full shape.
     - Case B: `{conversationId, message}` → same.
     - Case C (integration via `ValidationPipe`): `{}` → 400 before controller invoked.
2. **Service spec**
   - Remove `describe('startSession', ...)` (now private). Move coverage into `handleChat` branch tests.
   - Add `describe('handleChat', ...)`:
     - "creates session when conversationId absent" — mock `conversationRepo.save`, `messageRepo.save`, LLM → expect `conversationId` returned + first-turn greeting saved.
     - "reuses session when conversationId present" — mock `findOne` → existing convo; expect no new convo created.
     - "throws NotFound if convId invalid" — `findOne` returns null.
     - "throws BadRequest if expired" — `expiresAt` past.
     - "ignores `message` on creation call" — passes `{languages, message: 'hi'}`; assert `message` not included in LLM prompt (uses 'Start' instead).
   - Keep existing `complete` tests.
3. **DTO validation** (inline or new file)
   - `{}` → errors on both language fields.
   - `{conversationId: uuid}` → valid.
   - `{nativeLanguage: 'vi', targetLanguage: 'en'}` → valid.
   - `{conversationId: uuid, message: ''}` → valid (empty → undefined transform).
4. Run `npm test -- onboarding`. All green.
5. Run `npm run test:cov` — confirm service coverage ≥ previous.

## Todo List

- [ ] Remove obsolete `/start` controller tests
- [ ] Add controller `handleChat` cases
- [ ] Rewrite service tests for `handleChat`
- [ ] Add DTO validation cases
- [ ] `npm test` green
- [ ] Coverage not regressed

## Success Criteria

- All onboarding tests pass.
- No test references `StartOnboardingDto` or `/start`.
- DTO invalid-combo cases produce expected validation errors.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Private method tests leak via `as any` casts | Medium | Low | Test via public `handleChat` only; remove casts |
| LLM mock drift | Low | Medium | Reuse existing mock helpers from current spec |
| Flaky `expiresAt` Date comparisons | Low | Low | Use fixed `new Date()` or jest fake timers |

## Security Considerations

- Test that `message` on creation branch is not echoed into stored conversation as user message.
- Test that invalid UUID for `conversationId` → 400 (DTO) not 500.

## Next Steps

- Phase 06 (docs) uses verified API contract.
