# Phase 04: Tests (Unit + Integration)

## Context Links
- Reference test: `src/modules/ai/services/learning-agent-correction.service.spec.ts`
- Reference test: `src/modules/auth/auth.service.spec.ts`

## Overview
- Priority: P1
- Status: complete
- Effort: M (2h)

Write unit tests for `ScenarioChatService` branching + integration test for full turn cycle.

## Key Insights

- Existing tests mock repositories via `getRepositoryToken()` + `Repository.create/save` stubs.
- `UnifiedLLMService` should be mocked — tests should not hit real LLM APIs.
- Integration-style test can use in-memory sqlite or mock all repos; prefer mocks for speed.
- Use real `PromptLoaderService` (reads actual prompt file) to catch JSON template regressions.

## Requirements

**Functional coverage**
- New conversation + empty message → AI opening (no user message persisted)
- New conversation + user message → persists user msg + AI reply
- Resume conversation → validates ownership + scenarioId match
- Completed conversation → rejects with BadRequestException
- Max-turn behavior → `completed: true` set at turn 12
- Ownership violation → ForbiddenException
- ScenarioId mismatch → BadRequestException
- No active language → BadRequestException

**Non-functional**
- All tests pass with `npm test`
- No real network calls
- Assertions include `completed`, `turn`, `maxTurns` fields

## Architecture

### Test file: `src/modules/scenario/services/scenario-chat.service.spec.ts`

Structure:
```
describe('ScenarioChatService')
  describe('chat() - new conversation')
    it('creates conversation and returns opening when message empty')
    it('creates conversation and responds when message provided')
    it('persists user message when provided')
    it('does not persist user message when empty')
  describe('chat() - resume')
    it('reuses existing non-completed conversation')
    it('throws ForbiddenException when userId mismatch')
    it('throws BadRequestException when scenarioId mismatch')
  describe('chat() - turn limits')
    it('sets completed=true on turn 12')
    it('sets isWrapUp=true in prompt on turn 11+')
    it('throws BadRequestException when resuming completed conversation')
  describe('chat() - access control')
    it('throws ForbiddenException when scenario is premium and user is free')
    it('throws NotFoundException when scenario does not exist')
  describe('chat() - language context')
    it('throws BadRequestException when user has no active language')
    it('injects correct targetLanguage/nativeLanguage/proficiencyLevel into prompt')
```

### Mocking pattern
```ts
const mockConvoRepo = {
  createQueryBuilder: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
  create: jest.fn(dto => dto),
  save: jest.fn(entity => ({ ...entity, id: 'convo-uuid' })),
  findOne: jest.fn(),
};
const mockLlmService = { chat: jest.fn().mockResolvedValue('AI reply text') };
```

## Related Code Files

**Create**
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `src/modules/scenario/services/scenario-access.service.spec.ts`
- `src/modules/scenario/scenario-chat.controller.spec.ts` (minimal — just wiring)

**Read for reference**
- `src/modules/ai/services/learning-agent-correction.service.spec.ts` — mocking patterns

## Implementation Steps

1. Create `scenario-access.service.spec.ts` — test premium gate, missing scenario, access grant bypass.
2. Create `scenario-chat.service.spec.ts` covering all branches listed above.
3. Create `scenario-chat.controller.spec.ts` — smoke test that controller delegates to service.
4. Run `npm test -- scenario-chat` — all pass.
5. Run full suite `npm test` — no regressions.
6. Optional: E2E test in `test/scenario-chat.e2e-spec.ts` mirroring `test/onboarding.e2e-spec.ts` if exists.

## Todo List

- [x] Write `scenario-access.service.spec.ts` (access branches)
- [x] Write `scenario-chat.service.spec.ts` covering all described cases
- [x] Write `scenario-chat.controller.spec.ts` (minimal wiring test)
- [x] `npm test -- scenario` passes
- [x] `npm test` full suite passes, no regressions
- [x] Coverage for new service files ≥ 80%

## Success Criteria

- All listed test cases pass
- No flakiness (run 3x, same result)
- `npm run test:cov` shows ≥ 80% for new files
- No real LLM calls in test output

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Mocks drift from real repo behavior | Use `getRepositoryToken()` pattern + `Repository<Entity>` type |
| Prompt file not found in test env | Use real `PromptLoaderService`, confirm `__dirname` resolution works in Jest |
| QueryBuilder mocks complex | Provide factory helper `makeQueryBuilderMock()` returning chainable jest.fn() |

## Security Considerations
- Test that ownership bypass attempts are rejected (critical)
- Test that scenarioId mismatch is rejected (prevents cross-scenario hijack)

## Next Steps
- Phase 05: Documentation updates
