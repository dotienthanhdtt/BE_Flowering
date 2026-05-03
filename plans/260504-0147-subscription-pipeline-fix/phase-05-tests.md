# Phase 5 — Tests

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- Existing tests: `src/modules/subscription/__tests__/`, `src/common/guards/*.spec.ts`

## Overview
**Priority:** P0
**Status:** Pending
Cover the three code changes (Phases 2, 3, 4) with unit tests. No mocks for DB — use existing test patterns from IAP hardening Phase 7.

## Requirements

### resolveUser tests (Phase 2)
- `app_user_id` UUID match wins when aliases also contain valid UUIDs of other users.
- `original_app_user_id` used when `app_user_id` is anonymous.
- `aliases[]` fallback emits warning log.
- All-anonymous candidates → returns null.
- Non-UUID `app_user_id` skipped, falls through to next branch.

### ResourceAccessGuard tests (Phase 3)
- No `@RequireResourceAccess` decoration → allow.
- Resource ID missing → BadRequestException.
- Resource not found → NotFoundException.
- FREE tier → allow regardless of subscription.
- PREMIUM tier + premium user → allow.
- PREMIUM tier + free user → 403 ForbiddenException.
- PREMIUM tier + no `req.user` → 403.

### Drift log tests (Phase 4)
- Synthetic event with `app_user_id` ≠ `existing.appUserId` → warn log spy fires.
- Matching IDs → no log.
- New row (existing null) → no log.

### Regression
- Existing webhook idempotency tests pass.
- Existing premium guard tests pass.

## Related Code Files
**Modify / create:**
- `src/modules/subscription/__tests__/subscription.service.spec.ts` (add resolveUser + drift cases)
- `src/common/guards/resource-access.guard.spec.ts` (new file)

## Implementation Steps
1. Read existing `subscription.service.spec.ts` patterns.
2. Add `describe('resolveUser')` block with 5 cases above.
3. Add `describe('dispatch drift logging')` with 3 cases.
4. Create `resource-access.guard.spec.ts` mirroring `premium.guard.spec.ts` structure.
5. `npm test -- subscription.service.spec` and `npm test -- resource-access.guard.spec`.
6. Full suite: `npm test`.

## Todo List
- [ ] resolveUser unit tests (5 cases)
- [ ] Drift log unit tests (3 cases)
- [ ] ResourceAccessGuard unit tests (7 cases)
- [ ] All existing tests still green
- [ ] Coverage report shows changed files exercised

## Success Criteria
- All new tests pass.
- No regressions in existing suite.
- Coverage on touched files ≥ 80%.

## Risk Assessment
- Logger spy patterns — use Jest `jest.spyOn(Logger.prototype, 'warn')` consistent with existing tests.

## Next Steps
- Phase 6 runs after merge + deploy.
