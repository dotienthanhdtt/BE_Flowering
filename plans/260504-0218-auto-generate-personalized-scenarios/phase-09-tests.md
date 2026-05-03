# Phase 09 — Tests (Unit + Integration + E2E)

## Context Links
- All previous phases
- Onboarding tests as reference for mocking LLM

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Comprehensive coverage: unit per service, integration for trigger→generate, e2e with mocked LLM provider.

## Key Insights
- Mock `UnifiedLLMService` to return deterministic profile + scenarios.
- Use existing test DB pattern (TypeORM with sqlite/postgres test DB).
- Verify advisory lock by simulating concurrent calls (Postgres-only).

## Requirements
**Functional Coverage:**
- Quota: Free blocked, Plus unlimited, Plus daily ceiling, Premium first call ok, Premium second same month → paywall, Premium next UTC month → ok.
- Dedup: first call generates, same profile <24h skips, new key <24h generates, same profile >24h generates.
- Trigger: flagged scenario fires, unflagged doesn't, Free no fire, advisory lock dedups concurrent.
- Pruning: insert pushes over 30 → prune unused; used scenarios preserved.
- Paywall response shape: `{code:0, message:'upgrade_required', data:{upsellTo, conversationId}}`.
- Resume: paywall hit → /messages still returns conversation → after tier upgrade → /complete succeeds.
- Engine refactor: onboarding e2e unchanged.

**Non-Functional:**
- All tests deterministic (no real LLM).
- Total test runtime <60s.

## Architecture
- `*.spec.ts` co-located unit tests per service.
- `test/personalization.e2e-spec.ts` for HTTP-level flow with `supertest`.

## Related Code Files
**Modify:**
- Existing test config / fixtures as needed

**Create:**
- `src/modules/personalization/services/*.spec.ts` (one per service)
- `src/modules/ai/services/intake-chat-engine.spec.ts`
- `test/personalization.e2e-spec.ts`
- `test/fixtures/llm-mock.ts` (deterministic responses)

**Delete:** none

## Implementation Steps
1. Build LLM mock helper returning fixed profile + 5 fixed scenarios.
2. Unit test `PersonalizationQuotaService` — table-driven for all 6 cases.
3. Unit test `PersonalizationDedupService` — diff matrix.
4. Unit test `PersonalizationTriggerService` — gate cases; advisory lock tested via 2 concurrent promises hitting same userId.
5. Unit test `PersonalizationPruneService` — fixture with 35 scenarios.
6. Unit test `IntakeChatEngine` — turn flow + extraction call.
7. Re-run onboarding test suite — must pass.
8. E2E `personalization.e2e-spec.ts`:
   - login as Plus user → POST /chat 3 turns → POST /complete → assert 5 scenarios in DB.
   - login as Premium → /complete twice → assert paywall on 2nd, conversation persists.
   - login as Free → /chat → 403.
9. Run `npm run test:cov`; aim ≥85% for new module.
10. Fix all failures. NO skips.

## Todo List
- [ ] LLM mock fixture
- [ ] Quota unit tests
- [ ] Dedup unit tests
- [ ] Trigger unit tests (incl. lock concurrency)
- [ ] Prune unit tests
- [ ] Engine unit tests
- [ ] Onboarding regression pass
- [ ] E2E happy + paywall + free
- [ ] Coverage ≥85%

## Success Criteria
- `npm test` green.
- `npm run test:e2e` green.
- Coverage report shows ≥85% on `src/modules/personalization/**`.
- Onboarding suite untouched / fully passing.

## Risk Assessment
- **Advisory lock test flakiness** → use real Postgres in CI; skip if sqlite-only test DB.
- **Mock drift from real LLM contract** → schema-validate mock against Zod/DTO if available.

## Security Considerations
- Tests assert FREE blocked, ownership enforced on /messages.

## Next Steps
- Phase 10 instrumentation + final.
