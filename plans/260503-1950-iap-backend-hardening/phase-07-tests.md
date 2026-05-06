# Phase 7 — Tests

**Issues:** Coverage for all Phase 1–6 changes.
**Risk:** Low (test-only) but Phase 3 race tests are the load-bearing ones.

## Context

- All prior phase files.
- Existing tests under `test/` and any colocated `*.spec.ts`.

## Test Matrix

| Area | Test | Type |
|------|------|------|
| Phase 1 — `@ValidateNested` | Malformed inner DTO returns 400 | E2E |
| Phase 1 — Bearer-tolerant auth | `Bearer xxx` and bare `xxx` both pass | Unit |
| Phase 1 — Replay window | Event with ts older than 24h returns 200 + `outcome=stale_dropped` | E2E |
| Phase 1 — Throttle | 61st request in 60s returns 429 | E2E (fake throttler in test or skip if @nestjs/throttler too coupled) |
| Phase 2 — REFUND handler | REFUND event sets EXPIRED + currentPeriodEnd≤now | Unit |
| Phase 2 — Cron expansion | ACTIVE + updatedAt>7d ago is reconciled | Unit (mock RC client) |
| Phase 3 — Concurrent applyRcGroundTruth | 10 parallel calls produce 1 row, no exception | Integration (real DB) |
| Phase 3 — Equal-ts guard | Equal `eventTimestampMs` does NOT overwrite | Unit |
| Phase 3 — TRANSFER conflict | Destination row exists → `ConflictException` | Unit |
| Phase 4 — Guard cache hit | 2nd call within 60s does not hit DB | Unit (mock repo) |
| Phase 4 — Cache eviction | `subscription.changed` event evicts | Unit |
| Phase 5 — Unknown product | Throws + logs | Unit |
| Phase 5 — EXPIRATION sets plan=FREE | Snapshot the row | Unit |
| Phase 5 — Migration rename | `app_user_id` column exists, old name doesn't | Migration test (run + introspect) |
| Phase 6 — `isUniqueViolation` helper | Detects `23505`, ignores other codes | Unit |

## Implementation Steps

1. Add unit tests in `src/modules/subscription/__tests__/` mirroring source structure.
2. Add E2E webhook tests in `test/subscription.e2e-spec.ts`. Use NestJS testing module + supertest. Stub RC REST client with a mock that returns deterministic payloads.
3. Phase 3 race test: spin up the test PG via existing test-db config, run `Promise.all([applyRcGroundTruth] × 10)`, assert single row + no UniqueViolation propagated to caller.
4. Update `package.json` scripts only if new test runners are needed (likely none).
5. Aim for ≥85% line coverage on the subscription module after this phase.

## Files

- New: `src/modules/subscription/__tests__/subscription.service.spec.ts` (extend existing if present)
- New: `src/modules/subscription/__tests__/premium.guard.spec.ts`
- New: `test/subscription-webhook.e2e-spec.ts`
- New: `src/modules/subscription/__tests__/race.integration-spec.ts`

## Todo

- [ ] Webhook E2E suite (validation, auth, replay, throttle)
- [ ] REFUND + cron unit tests
- [ ] Race condition integration test
- [ ] Guard cache tests
- [ ] Phase 5 mapping/normalization tests
- [ ] All tests pass under `npm test`
- [ ] Coverage report verifies ≥85% on subscription module

## Success Criteria

- `npm test` green.
- `npm run test:e2e` green.
- Race test demonstrates lock works (forced regression: comment out the `lock: pessimistic_write` → test fails).

## Risks

- E2E tests need a webhook secret in test env — wire via `.env.test`.
- Throttle E2E may be flaky if test runner reuses IP across cases — scope throttler instance per spec or use mock.
