# Phase 05 — Tests update + new invariant tests

## Context Links
- Spec files touched: `scenario-access.service.spec.ts`, `lesson.service.spec.ts`, `admin-content.service.spec.ts`, `scenario-chat.service.spec.ts`
- Production code finalized in Phases 02–03

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Update existing unit tests to use `accessTier` instead of `isPremium`/`isTrial`/`isActive`. Add invariant tests: (1) premium scenario without subscription/grant → Forbidden; (2) free scenario → always accessible; (3) archived scenario → NotFound.

## Key Insights
- `lesson.service.spec.ts` has dedicated "Status - Trial" describe block — delete entirely (TRIAL removed).
- `scenario-access.service.spec.ts` mock fixtures use `isPremium`/`isActive` literals — must become `accessTier`.
- `lesson.service.spec.ts` `mockScenario` factory must drop `isPremium`/`isTrial`/`isActive` and add `accessTier`.
- DO NOT mock scenarios with fake data just to make green — tests must exercise real access decision logic.
- Tests are tester-owned files (`*.spec.ts`); no ownership conflict with Phase 03.

## Requirements

### Functional — update
- Replace all `isPremium: true|false`, `isTrial: true|false`, `isActive: true|false` in mocks with `accessTier: AccessTier.PREMIUM|FREE`
- Update `where` clause expectations: `{ id, status: 'published' }` (drop `isActive: true`)
- Update computeStatus expectations (2 outputs only)

### Functional — add (invariants)
- `ScenarioAccessService`:
  - Free scenario → accessible without subscription or grant
  - Premium scenario + active subscription → accessible
  - Premium scenario + grant → accessible
  - Premium scenario + no sub + no grant → ForbiddenException
  - Archived scenario (`status=ARCHIVED`) → NotFoundException (new — was implicitly covered by `isActive=false`; now codifies status path)
- `LessonService`:
  - Archived scenarios excluded from visibility
  - `computeStatus`: premium+free-user = LOCKED; premium+paid-user = AVAILABLE; free+any-user = AVAILABLE

### Non-functional
- All tests use `AccessTier` enum values (no string literals like `'premium'`)
- Keep mock fixtures under 200 lines per file

## Architecture

### Test matrix

| Test subject | Input | Expected |
|---|---|---|
| Access: free scenario, anon-sub user | accessTier=FREE, no sub | return scenario |
| Access: premium + active sub | accessTier=PREMIUM, sub.isActive=true | return scenario |
| Access: premium + explicit grant | accessTier=PREMIUM, sub=null, grant exists | return scenario |
| Access: premium + no sub + no grant | accessTier=PREMIUM, sub=null, grant=null | ForbiddenException |
| Access: premium + inactive sub + no grant | accessTier=PREMIUM, sub.isActive=false | ForbiddenException |
| Access: archived scenario | status=ARCHIVED | NotFoundException |
| Access: non-existent scenario | findOne=null | NotFoundException |
| Lesson status: free scenario | accessTier=FREE, any user | AVAILABLE |
| Lesson status: premium + free user | accessTier=PREMIUM, no sub | LOCKED |
| Lesson status: premium + paid user | accessTier=PREMIUM, active sub | AVAILABLE |
| Lesson visibility: includes status=PUBLISHED only | — | archived excluded |

## Related Code Files

**Modify (tester-owned):**
- `src/modules/scenario/services/scenario-access.service.spec.ts`
- `src/modules/lesson/lesson.service.spec.ts`
- `src/modules/admin-content/admin-content.service.spec.ts`
- `src/modules/scenario/services/scenario-chat.service.spec.ts` (fixture `mockScenario` — verify no flag refs)

## Implementation Steps

### scenario-access.service.spec.ts
1. Import `AccessTier` from entities.
2. Rewrite `mockFreeScenario`, `mockPremiumScenario` fixtures — swap `isPremium`/`isActive` for `accessTier`.
3. Update all `expect(scenarioRepo.findOne).toHaveBeenCalledWith` to match new `where: { id, status: 'published' }`.
4. Add new test: "should throw NotFoundException when scenario status=archived" (mock `findOne` returns null — simulates status filter).
5. Keep existing premium gate tests; update mock `isPremium: true` → `accessTier: AccessTier.PREMIUM`.

### lesson.service.spec.ts
1. Update `mockScenario` factory: remove `isPremium`/`isTrial`/`isActive`; add `accessTier: AccessTier.FREE` default.
2. DELETE entire `describe('Status - Trial', ...)` block.
3. Rename `describe('Status - Locked (Premium + Free User)')` kept; adjust inner mocks.
4. Update `describe('Edge Cases')` items that use `isPremium: true` — swap to `accessTier: AccessTier.PREMIUM`.
5. Update visibility-query expectation: `expect(queryBuilder.where).toHaveBeenCalledWith('scenario.status = :status', { status: 'published' })` (or however the final code structures it).

### admin-content.service.spec.ts
1. Update the `generateDrafts` test payloads: LLM JSON now emits `accessTier` instead of `isPremium`.
2. Update save-expectation assertion to include `accessTier: AccessTier.FREE`.
3. No new tests required — coverage stable.

### scenario-chat.service.spec.ts
1. Inspect `mockScenario` — remove any `isPremium`/`isTrial` if present (current fixture on lines 90–96 does not use these; likely no change).
2. Double-check after Phase 03.

### Run
1. `npm test` — iterate fixes until all green.
2. Do NOT weaken assertions to pass; fix root cause.

## Todo List
- [x] Update scenario-access spec fixtures + assertions
- [x] Add archived-status NotFound invariant test
- [x] Rewrite lesson.service.spec — delete Trial block, adjust fixtures
- [x] Update admin-content spec LLM JSON samples
- [x] Verify scenario-chat spec unaffected
- [x] `npm test` all green
- [x] `npm run test:cov` — no regression on access/lesson/admin-content coverage

## Success Criteria
- All specs pass: `npm test`
- No `isPremium | isTrial` string in `**/*.spec.ts`
- New invariant tests present and assert the 3 premium-gate paths explicitly
- Coverage for modified services ≥ prior coverage

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Lesson spec's deep mock query-builder assertion brittle | High | Low | Match the exact call signature produced by Phase 03 code; don't over-assert |
| Forgotten `isTrial: true` mock in edge-case tests → compile error | Med | Low | TS compile surfaces; fix inline |
| Trial removal hides a real product requirement | Low | High | Product confirmed — document in `project-changelog.md` during Phase 06 |

## Security Considerations
- Invariant tests lock down that premium gate cannot be bypassed — regression-guard against future flag-soup return.

## Next Steps
- Phase 06 docs sync
