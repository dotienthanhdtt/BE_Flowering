# Phase 01 — Access Service Refactor (non-throwing `checkAccess`)

## Context Links

- Brainstorm: `plans/reports/brainstorm-260421-1901-scenario-detail-api.md` §4.4
- Overview plan: `plan.md`
- File to modify: `src/modules/scenario/services/scenario-access.service.ts`
- Spec to modify: `src/modules/scenario/services/scenario-access.service.spec.ts`

## Overview

**Priority:** P1 (blocks phase 02)
**Status:** completed
**Effort:** 1h

Add `checkAccess(userId, scenarioId, languageId)` method to `ScenarioAccessService`. Returns `{ scenario, isLocked, lockReason }` — throws `NotFoundException` for hard errors (missing, unpublished, wrong language) but returns `isLocked=true` instead of throwing `ForbiddenException` for premium blocks. Existing `findAccessibleScenario` stays unchanged (still used by chat flow).

## Key Insights

- Premium block is a *soft* state for the detail endpoint but a *hard* state for chat. Split the rule into two callers of a shared private helper.
- DRY via private `#evaluatePremiumAccess(userId, scenarioId): Promise<{ hasAccess: boolean }>` shared by both public methods.
- No DB schema changes; reuses `scenarioRepo`, `accessRepo`, `subscriptionService` already injected.

## Requirements

### Functional
- `checkAccess` throws `NotFoundException('Scenario not found')` when scenario missing or `status !== PUBLISHED`.
- `checkAccess` throws `NotFoundException('Scenario not available for active language')` when `languageId` param provided and mismatches.
- `checkAccess` returns `{ scenario, isLocked: false }` for FREE tier.
- `checkAccess` returns `{ scenario, isLocked: false }` for PREMIUM tier when user has active subscription OR explicit grant.
- `checkAccess` returns `{ scenario, isLocked: true, lockReason: 'premium_required' }` for PREMIUM tier without subscription and without grant.
- `findAccessibleScenario` behavior preserved — no breaking changes to callers.

### Non-functional
- File stays under 200 LoC.
- No new dependencies.
- Single DB query path (no double-fetch).

## Architecture

```
ScenarioAccessService
├── findAccessibleScenario(userId, id, langId?)   [existing, unchanged externally]
│     └── loads scenario → #evaluatePremiumAccess → throw Forbidden if blocked
└── checkAccess(userId, id, langId?)              [NEW]
      └── loads scenario → #evaluatePremiumAccess → return {isLocked, lockReason}
```

## Related Code Files

**Modify:**
- `src/modules/scenario/services/scenario-access.service.ts` — add `checkAccess`, extract private helper
- `src/modules/scenario/services/scenario-access.service.spec.ts` — add 5 tests for new method

**No create. No delete.**

## Implementation Steps

1. Extract current premium-check body of `assertPremiumAccess` into a shared private method `evaluatePremiumAccess(userId, scenarioId): Promise<boolean>` returning `true` if user can access premium scenario.
2. Rewrite `assertPremiumAccess` to call `evaluatePremiumAccess` and throw `ForbiddenException` when `false`.
3. Add `checkAccess(userId, scenarioId, languageId?)`:
   - Load scenario with `relations: ['category']` and `status: PUBLISHED` filter.
   - Throw `NotFoundException` if not found.
   - Throw `NotFoundException` if `languageId` provided and mismatched.
   - If `accessTier !== PREMIUM`, return `{ scenario, isLocked: false }`.
   - Call `evaluatePremiumAccess` — if `true` return `{ scenario, isLocked: false }`; else return `{ scenario, isLocked: true, lockReason: 'premium_required' }`.
4. Define export type at top of file:
   ```ts
   export type ScenarioAccessResult =
     | { scenario: Scenario; isLocked: false; lockReason?: never }
     | { scenario: Scenario; isLocked: true; lockReason: 'premium_required' };
   ```
5. Update `scenario-access.service.spec.ts` — add describe block `checkAccess()` with 5 tests:
   - 404 on missing scenario
   - 404 on language mismatch
   - isLocked=false on FREE tier
   - isLocked=false on PREMIUM + active sub
   - isLocked=false on PREMIUM + explicit grant
   - isLocked=true on PREMIUM + no sub + no grant
6. Run `npm run build` then `npm test -- scenario-access.service.spec.ts`.

## Todo List

- [x] Extract `evaluatePremiumAccess` private helper
- [x] Add `ScenarioAccessResult` exported type
- [x] Implement `checkAccess` method
- [x] Ensure `findAccessibleScenario` still passes existing tests
- [x] Add 6 new unit tests in spec file
- [x] `npm run build` green
- [x] `npm test -- scenario-access` green

## Success Criteria

- All existing `findAccessibleScenario` tests still pass.
- New `checkAccess` tests cover all 6 cases from matrix.
- No regressions in chat flow (`scenario-chat.service.spec.ts`).
- File under 200 LoC.

## Risk Assessment

- **Risk:** existing chat tests fail if `findAccessibleScenario` changes accidentally. **Mitigation:** extract only the private body; keep public signature + throw behavior identical. Run `npm test` (not just one file) before calling done.
- **Risk:** `evaluatePremiumAccess` typo or missed async. **Mitigation:** unit tests for the public methods implicitly cover the private helper.

## Security Considerations

- No new access surface — `checkAccess` still requires authenticated `userId` (enforced by controller guard).
- Language mismatch returns 404 (not 403) — deliberate, matches existing pattern; no info leakage.

## Next Steps

- Phase 02 consumes `checkAccess` to build the detail endpoint.
