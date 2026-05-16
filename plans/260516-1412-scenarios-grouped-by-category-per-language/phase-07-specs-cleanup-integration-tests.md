---
phase: 7
title: "Specs + cleanup + integration tests"
status: completed
priority: P1
effort: "4h"
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 7: Specs + cleanup + integration tests

## Overview
Update unit specs for changed services, delete tests for removed endpoints, add integration coverage for the unified endpoint and trigger behavior. Verify full build and migration replay.

## Requirements
- Functional: all unit + integration tests pass with `npm test` and `npm run test:e2e`.
- Functional: no orphan references to `/scenarios/default` or `/scenarios/personal` in code or specs.
- Non-functional: coverage maintained or improved over baseline.

## Architecture

### Specs to update / delete
| File | Action |
|---|---|
| `src/modules/scenario/services/scenarios-listing.service.spec.ts` | Rewrite for `listGrouped`; cover empty categories hidden, sort order, lock semantics, KOL inclusion |
| `src/modules/scenario/services/scenarios-redeem.service.spec.ts` | Verify behavior unchanged; add post-redeem listing assertion if listing service mocked |
| `src/modules/personalization/services/personalization.service.spec.ts` | Add cases for `resolveCategoryId`: onboarding → `for_you`, trigger with valid source → inherit, trigger with cross-lang source → fallback, missing `for_you` → throws |
| `src/modules/scenario/dto/scenario-chat.dto.spec.ts` | Confirm unaffected |
| Any test referencing `/scenarios/default` or `/scenarios/personal` | Remove or migrate to `/scenarios` |

### New integration tests
- `test/scenarios-grouped.e2e-spec.ts` (or inside existing e2e suite):
  - Seed: 1 user, 2 active langs, 2 system categories with scenarios per lang, 1 personal scenario, 1 KOL scenario (redeemed).
  - Assert: `GET /scenarios` with EN header returns categories sorted by `order_index`, scenarios mixed and recency-sorted, KOL appears with `source='kol'` and `addedAt=granted_at`.
  - Assert: switching `X-Learning-Language` to ES returns ES categories only.
  - Assert: deleting all scenarios in a category hides that category from response.

### Trigger smoke test
Either:
- Add a DB-only integration test inserting a row with NULL `category_id` and asserting trigger fills it.
- Or document manual SQL smoke in `docs/deployment-guide.md`.

### Docs sync
Update:
- `docs/api-documentation.md` — replace `/default` + `/personal` sections with `/scenarios`.
- `docs/codebase-summary.md` — mention language-scoped categories.
- `docs/system-architecture.md` — diagram update if scenarios listing is shown.
- `docs/project-changelog.md` — record breaking change.

## Related Code Files
- Modify: spec files listed above.
- Create: integration test file (location per existing convention).
- Modify: `docs/api-documentation.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/project-changelog.md`.
- Delete: any unused DTO/service code from old endpoints (final sweep).

## Implementation Steps
1. Run `grep -rn "/scenarios/default\|/scenarios/personal\|listDefault\|listPersonal" src test docs` → enumerate cleanup targets.
2. Update each spec following the table above.
3. Write the integration test.
4. Run `npm run lint && npm run build && npm test && npm run test:e2e`.
5. Update docs.
6. Final manual end-to-end on dev: clean DB, run migrations, hit Swagger UI, redeem a KOL bundle, complete a trigger-personalization, verify `/scenarios` reflects everything correctly grouped.

## Success Criteria
- [ ] `npm test` passes (all unit specs).
- [ ] `npm run test:e2e` passes including new grouped endpoint test.
- [ ] `npm run lint` and `npm run build` pass.
- [ ] No references to removed endpoints remain in `src` or `test`.
- [ ] `docs/` updated; changelog entry added.
- [ ] Manual e2e green on Railway dev.

## Risk Assessment
- **Risk:** Hidden test fixtures still create personal scenarios without category and rely on listing them under `/personal`. **Mitigation:** grep sweep before writing tests; trigger fills NULL automatically so existing fixtures should keep working.
- **Risk:** E2E test flake from `markLastLearned` race. **Mitigation:** transaction already serializes; ensure test cleans `user_languages` between cases.
- **Risk:** Doc drift if changelog skipped. **Mitigation:** explicit Success Criterion bullet.
