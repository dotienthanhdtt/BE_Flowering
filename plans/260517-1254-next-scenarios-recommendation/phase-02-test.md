---
phase: 2
title: "Test"
status: pending
priority: P2
effort: "1h"
dependencies: [1]
---

# Phase 2: Test

## Overview
Unit tests for `ScenarioRecommenderService` covering tier matrix + edge cases. Update `scenario-complete.service.spec.ts` to mock the recommender and assert `next_scenarios` is attached on all response branches.

## Test matrix (recommender)

| # | Setup | Expectation |
|---|-------|-------------|
| 1 | 3 un-locked same-cat candidates | Returns top 2 by order_index |
| 2 | 1 un-locked same-cat, 2 un-locked diff-cat | Returns the same-cat then 1 diff-cat |
| 3 | 0 un-locked, 2 locked same-cat (free user) | Returns 2 locked same-cat |
| 4 | Free user, anchor categoryId=null, mixed pool | All candidates treated as diff-cat (tiers 2 & 4 only) |
| 5 | Premium user, mixed pool with premium scenarios | None marked `is_locked: true`; tier 1/2 dominate |
| 6 | Premium user with explicit `user_scenario_access` for a premium scenario | That scenario unlocked even if subscription stub returns false |
| 7 | All other scenarios have DONE conversation | Returns `[]` |
| 8 | Anchor is the only scenario in language | Returns `[]` |
| 9 | Candidate exists with CHATTING (non-DONE) conversation | Still included (per spec: only DONE excludes) |
| 10 | language_id mismatch | Returns `[]` |

## Tests for `scenario-complete.service.spec.ts`
- Mock `ScenarioRecommenderService.recommendNext` → returns 2 items.
- Assert `result.next_scenarios` length=2 on:
  - happy path (fresh evaluation)
  - cached evaluation (idempotent replay)
  - retry-cap reached branch
- Assert empty `[]` is honored.

## Related Code Files
- Create: `src/modules/scenario/services/scenario-recommender.service.spec.ts`
- Modify: `src/modules/scenario/services/scenario-complete.service.spec.ts` (add recommender mock + 3 new assertions)

## Implementation Steps
1. Write recommender spec with the 10 cases. Use repo-mock pattern (`scenarioRepo.query` returns canned rows).
2. Add `ScenarioRecommenderService` provider mock to `scenario-complete.service.spec.ts` test module.
3. Assert `next_scenarios` propagates on all three branches.
4. Run: `npx jest src/modules/scenario/` — must hit 100% pass.

## Success Criteria
- [ ] Recommender spec: 10 cases, all green
- [ ] Complete spec: 3 new assertions pass; existing 21 tests still green
- [ ] Total scenario module tests: previously 176 → 186+ (10 new + 3 modified)

## Risk Assessment
- **Risk:** mocking `scenarioRepo.query` with raw rows can drift from real SQL column names. **Mitigation:** keep test fixtures in a single helper, and add one integration smoke test (optional) that hits a real test DB.
