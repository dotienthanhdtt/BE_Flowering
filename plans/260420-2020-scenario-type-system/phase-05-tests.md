# Phase 05 — Tests

## Context Links

- Phase 02 — `RolesGuard` spec (created inline there)
- Phase 03 — listing + redeem services (spec files stubbed, implemented here)
- Phase 04 — KOL bundle service
- Existing specs: `src/modules/lesson/lesson.service.spec.ts`, `src/modules/scenario/services/scenario-access.service.spec.ts`

## Overview

- Priority: P1
- Status: done
- Unit tests for new services; e2e tests for the 3 `/scenarios/*` endpoints and redeem happy/error paths.

## Key Insights

- Project does not currently have an e2e test harness (no `test/` folder, only `npm run test:e2e` target). **Decision:** if harness absent, scope phase-05 to unit tests + integration-style supertest inside `*.e2e-spec.ts` mounting `AppModule` with overridden DB. If e2e infra creation is out of scope, skip e2e and rely on unit + manual smoke from phase-03/04. **Check:** inspect `package.json` `test:e2e` script and any `jest-e2e.json` config before scoping.
- Unit specs mock repositories — follow pattern in `lesson.service.spec.ts`.
- Migration tests: not required — cover via manual `migration:run` + `migration:revert` (see phase-01 success criteria).

## Requirements

### Unit Tests

#### `roles.guard.spec.ts` (phase-02 deliverable — listed here for completeness)
- No `@Roles` metadata -> allows
- User has required role -> allows
- User missing role -> throws ForbiddenException
- No user on request -> throws

#### `scenarios-listing.service.spec.ts`
- `listDefault`: filters by type='default', status='published', language — asserts QB where clauses
- `listDefault`: pagination math (skip/take) correct for page 2, limit 20
- `listPersonal`: merges personalized + KOL entries
- `listPersonal`: sorts by addedAt DESC across both sources
- `listPersonal`: pagination applied after merge (not per-query)
- `listPersonal`: empty personalized + empty KOL -> total 0

#### `scenarios-redeem.service.spec.ts`
- Unknown gift code -> NotFoundException
- Valid code, first time -> inserts all scenario access rows, returns scenarios
- Valid code, re-redeem by same user -> idempotent (no duplicate insert; returns same scenarios)
- Gift code normalization: lowercase input matched to uppercase-stored bundle
- Empty bundle (defensive) -> NotFoundException

#### `kol-bundle.service.spec.ts` (phase-04)
- Create: creator without `'kol'` role -> BadRequestException
- Create: duplicate gift code -> 409 (QueryFailedError 23505)
- Create: scenario already attached to another bundle -> 409
- Create: happy path -> bundle persisted + all join rows inserted, transaction commits
- Attach: bundle not found -> 404
- Attach: duplicate scenario across bundles -> 409

### E2E Tests (conditional on harness existence)

If `test:e2e` harness usable:
- `scenarios-default.e2e-spec.ts` — seed 3 scenarios, call endpoint, assert pagination + type filter
- `scenarios-personal.e2e-spec.ts` — seed 2 user_ai + 1 KOL grant, assert merge ordering
- `scenarios-redeem.e2e-spec.ts` — seed bundle, POST redeem, assert 200 + idempotent re-call
- `admin-kol-bundle.e2e-spec.ts` — create bundle, attach scenarios, GET listing

### Non-Functional

- Unit coverage on new services > 80% lines.
- All specs run in `npm test` without network or real DB.

## Architecture

Unit tests use `@nestjs/testing` `Test.createTestingModule` + mocked repositories via `{ provide: getRepositoryToken(Entity), useValue: mockRepo }` — standard pattern in repo.

E2E tests (if scoped in):
- Use an isolated Postgres (docker-compose or testcontainers) OR sqlite memory driver override.
- Current project uses Postgres-specific features (enums, arrays) — sqlite will NOT work.
- **Decision:** require a `DATABASE_TEST_URL` env; run migrations before e2e; skip e2e if not set (guarded via `describe.skip` check).

## Related Code Files

### Modify

- `src/modules/auth/auth.controller.spec.ts` — fixture updated in phase-02; confirm tests still green
- `src/modules/auth/auth.service.spec.ts` — same

### Create

- `src/common/guards/roles.guard.spec.ts` (already created in phase-02)
- `src/modules/scenario/services/scenarios-listing.service.spec.ts`
- `src/modules/scenario/services/scenarios-redeem.service.spec.ts`
- `src/modules/kol-bundle/kol-bundle.service.spec.ts`
- Optional: `test/scenarios-default.e2e-spec.ts`, `test/scenarios-personal.e2e-spec.ts`, `test/scenarios-redeem.e2e-spec.ts`, `test/admin-kol-bundle.e2e-spec.ts`

## Implementation Steps

1. Inspect `package.json` test scripts + any existing `jest-e2e.json`. Determine e2e harness status.
2. Write `scenarios-listing.service.spec.ts` — mock `Repository<Scenario>`, `Repository<UserAiScenario>`, `Repository<UserScenarioAccess>`. Cover 6 cases above.
3. Write `scenarios-redeem.service.spec.ts` — mock 4 repos + insert `.orIgnore()` behavior. Cover 5 cases.
4. Write `kol-bundle.service.spec.ts` — mock DataSource `transaction` helper. Cover 6 cases.
5. If e2e harness exists + `DATABASE_TEST_URL` is set:
   - Bootstrap a Nest app via `Test.createTestingModule({ imports: [AppModule] })` with DB override.
   - Run migrations via `DataSource.runMigrations()` in `beforeAll`.
   - Seed minimal fixtures (language, user, scenario) inline.
   - Use `supertest` to hit endpoints with a fake JWT (sign one with dev secret).
6. Ensure no test commits `isAdmin` refs (phase-02 cleaned these).
7. `npm test` green.

## Todo List

- [ ] Inspect e2e harness; decide inclusion
- [ ] `scenarios-listing.service.spec.ts`
- [ ] `scenarios-redeem.service.spec.ts`
- [ ] `kol-bundle.service.spec.ts`
- [ ] E2E specs (conditional)
- [ ] `npm test` green
- [ ] (If e2e) `npm run test:e2e` green

## Success Criteria

- All existing tests still pass after phase-02 fixture updates.
- New unit specs have `>= 80%` line coverage on the 3 new services.
- `npm run lint` clean on new files.
- E2E (if scoped) passes a redeem idempotency test (2 POSTs return 200, only 1 access row inserted).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mock repo drift — tests pass but production QB fails | Med | High | Supplement with e2e for the critical redeem path if feasible |
| E2E harness absent — phase-05 scope balloons | High | Med | Cap scope to unit tests + manual smoke; document in final summary |
| Postgres-specific SQL (arrays, enums) untestable without real DB | High | Med | Unit tests validate service logic only; DB semantics covered by manual migration apply/revert |
| Fixture updates in phase-02 break unrelated tests | Low | Low | Run full `npm test` after phase-02; fix drift before phase-05 |

## Security Considerations

- E2E tests must NOT run against production DB. Guard on env var presence.
- Test JWTs signed with local secret only; never commit real secrets in fixtures.

## Next Steps

- Phase-06: docs update after all tests green.
