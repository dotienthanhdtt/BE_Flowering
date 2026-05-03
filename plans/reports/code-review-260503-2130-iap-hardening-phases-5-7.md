# Code Review: IAP Backend Hardening Phases 5–7

**Date:** 2026-05-03
**Reviewer:** code-reviewer agent
**Baseline:** commit `9196e4a`
**Scope:** Phases 5 (correctness fixes), 6 (minor + observability), 7 (tests)

---

## Summary

Phases 5 and 6 are implemented correctly and cleanly. The production code maps to plan
todos with no notable defects. **Phase 7 (Tests) is the load-bearing weakness** — the
two most critical test guarantees from the plan (race-condition integration coverage and
webhook E2E coverage) are not actually exercised: the race tests are `it.skip(...)` and
the "E2E" file is a set of tautological logic tests that never instantiate the controller.
Build is clean (`tsc --noEmit` exits 0). Migration is reasonable but has small idempotency
gaps. Backwards compatibility is fine — no surviving `revenuecatId` references.

---

## Phase Compliance Matrix

| Plan Todo | Status | Evidence |
|---|---|---|
| **Phase 5** — Strict product mapping, throw on unknown | OK | `subscription.service.ts:542-551` |
| **Phase 5** — EXPIRATION sets plan=FREE | OK | `subscription.service.ts:407-415` |
| **Phase 5** — Cron full-batch warning | OK | `subscription-reconciliation.cron.ts:82-86` |
| **Phase 5** — Migration rename + autoResumeAt | Partial | Idempotency gap on rename; see C2 |
| **Phase 5** — Update entity + service references | OK | All `revenuecatId` removed |
| **Phase 5** — PAUSE persists autoResumeAt | OK | `subscription.service.ts:442-459` |
| **Phase 6** — Extract isUniqueViolation | OK | `utils/db-errors.util.ts` + 2 callsites |
| **Phase 6** — Verify/remove X-Platform header | OK | `revenuecat-rest-client.ts:102-103` |
| **Phase 6** — Deterministic activeProductId pick | OK | `revenuecat-rest-client.ts:165-170` |
| **Phase 6** — Structured logs (event=/outcome=/latency_ms=) | OK | service + controller + cron |
| **Phase 6** — Outcome propagated to controller body | OK | controller returns `{status, outcome}` |
| **Phase 7** — Webhook E2E suite | **Failed** | See C1 |
| **Phase 7** — REFUND + cron unit tests | OK | `subscription.service.spec.ts` |
| **Phase 7** — Race condition integration test | **Failed** | See C3 — `it.skip` |
| **Phase 7** — Guard cache + eviction tests | OK | `premium.guard.spec.ts` |
| **Phase 7** — Mapping/normalization tests | OK | `subscription.service.spec.ts` |
| **Phase 7** — Migration test | Missing | No introspection test for column rename |
| **Phase 7** — ≥85% coverage | Unverified | No coverage report attached |

---

## Critical Findings

### C1 — `test/subscription-webhook.e2e-spec.ts` is not an E2E test (BLOCKER)

The file is named `e2e-spec.ts` and Phase 7 explicitly required:

> Phase 1 — `@ValidateNested` Malformed inner DTO returns 400 | E2E
> Phase 1 — Replay window | Event with ts older than 24h returns 200 + outcome=stale_dropped | E2E
> Phase 1 — Throttle | 61st request in 60s returns 429 | E2E

What was actually written are tautological string/timing/regex tests that never instantiate
the NestJS app, never invoke `RevenuecatWebhookController`, never exercise any pipe or guard:

```ts
it('should require event.id field', () => {
  const eventWithoutId: any = { type: 'RENEWAL' };
  expect(eventWithoutId.type).toBeUndefined();  // <-- tests JS, not the controller
});

it('should detect duplicate by eventId', () => {
  const event1 = { id: 'evt-same-123', type: 'RENEWAL' };
  const event2 = { id: 'evt-same-123', type: 'RENEWAL' };
  expect(event1.id).toBe(event2.id);  // <-- always true; no DB or service involved
});
```

These tests will pass even if `RevenuecatWebhookController` is deleted. They provide
**zero regression protection** for the auth, replay window, throttling, validation,
or sandbox-drop paths. The header comment even acknowledges the gap ("Full E2E tests
require a running PostgreSQL database and are complex to set up"), but that does not
satisfy Phase 7's success criteria.

**Required fix:** Use `Test.createTestingModule()` + `supertest` to build the app
and POST real payloads to `/webhooks/revenuecat`. Stub `SubscriptionService` if
DB is undesirable, but the controller (auth, throttle, replay, ValidationPipe)
must be exercised through HTTP. The webhook secret can come from `.env.test` as
the plan notes.

### C2 — Migration is not safely re-runnable on partial state

`1780000000000-rename-revenuecat-id-and-add-auto-resume.ts:5-10`:

```ts
await queryRunner.query(`ALTER TABLE subscriptions RENAME COLUMN revenuecat_id TO app_user_id`);
await queryRunner.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_resume_at ...`);
```

- Line 1 has **no `IF EXISTS`**. If a previous deploy partially applied the migration
  (rename succeeded, then a later step blew up before the migration row was inserted),
  re-running fails with `column "revenuecat_id" does not exist`. TypeORM's migration
  table normally guards this, but in DR / restored-from-snapshot scenarios the rename
  is irreversible by retry.
- The down() has the inverse asymmetry: `DROP COLUMN IF EXISTS auto_resume_at` is safe,
  but `RENAME COLUMN app_user_id TO revenuecat_id` will fail if `revenuecat_id` already
  exists (e.g. if the down was previously partly applied).
- `auto_resume_at` is added at the **end** of the table; in PG this is fine, but for
  `pg_dump`-and-restore consistency teams sometimes prefer placing it next to related
  columns. Non-blocking.

**Recommended:**

```ts
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='subscriptions' AND column_name='revenuecat_id') THEN
    ALTER TABLE subscriptions RENAME COLUMN revenuecat_id TO app_user_id;
  END IF;
END $$;
```

Same pattern for the down(). This makes both directions idempotent.

### C3 — Race-condition test is `.skip`'d (BLOCKER for Phase 7 success criteria)

`src/modules/subscription/__tests__/race.integration-spec.ts:148, 188` — both
`it()` calls are `it.skip(...)`. Phase 7 success criteria explicitly state:

> Race test demonstrates lock works (forced regression: comment out the
> `lock: pessimistic_write` → test fails).

A `.skip`'d test cannot fail under regression — by definition it is not running.
The test scaffolding is reasonable (real DataSource, 10 parallel calls,
asserts single row), but unless wired into the test runner with a real PG URL it
provides no protection. Either:

1. Configure a `npm run test:integration` script that runs against a real PG and
   gate it on `DATABASE_URL=postgres://*`, or
2. Use `pg-mem` / Testcontainers Postgres so it runs in CI without external setup,
   then change `it.skip` → `it`.

The plan was explicit that this test is "load-bearing" — leaving it skipped means
Phase 3's locking work has no automated regression test.

---

## High-Severity Findings

### H1 — `mapToDto` returns `Subscription.autoResumeAt` (a `Date | null | undefined`) typed as `Date | null`

`subscription.service.ts:581`: `autoResumeAt: subscription.autoResumeAt ?? null`. Fine.
But `SubscriptionDto.autoResumeAt?: Date | null` (DTO is optional) while plan says
"expose as ISO string". The serializer will JSON-serialize a Date to ISO automatically,
so the wire shape is correct, but the JSDoc on the DTO claims "ISO timestamp" while
the type is `Date`. Cosmetic; flag for clarity. No bug.

### H2 — TRANSFER may violate `userId UNIQUE` constraint despite the conflict check

`subscription.entity.ts:36`: `@Column({ type: 'uuid', name: 'user_id', unique: true })`.
`handleTransfer` checks for existing destination row before updating
(`subscription.service.ts:515-522`), which is correct, BUT the check + update happen
under pessimistic locks on **both** rows by `userId`. If a NEW (third) row is created
for `toId` between the lock acquisition (which only locks existing rows, not gaps)
and the `update(... userId: toId ...)`, the unique constraint will reject the update.

Realistic scenario: TRANSFER and INITIAL_PURCHASE arriving for the destination user
near-simultaneously. Pessimistic row locks do not prevent inserts at non-existent
PKs. The unique constraint will catch it (correctness preserved), but the webhook
will fail with a 23505 that is not classified as `outcome=duplicate` here — it would
bubble up as a transaction error and trigger an RC retry. Probably acceptable, but
worth documenting. Could be tightened with `INSERT ... ON CONFLICT (user_id) DO NOTHING`
patterns or by holding the user-row lock during the relink, but plan didn't mandate
that work.

### H3 — `recordIdempotency()` runs OUTSIDE the transaction for SILENT_ACK events

`subscription.service.ts:90`: silent-ack events insert the idempotency row via
`this.webhookEventRepo.insert()` directly, then return `{outcome: 'processed'}`.
That's fine for `TEST` etc., but the comment "Still record it for idempotency —
outside a transaction is fine since handler is a no-op" is correct only because
no business logic runs. If a future contributor adds any side-effect to silent-ack
events, the idempotency window between insert and side-effect is not covered. A
small comment block warning to future-readers would help.

---

## Medium-Severity Findings

### M1 — `mapProductToPlan` substring matching is fragile

`subscription.service.ts:543-546`: substring `includes('monthly')` will misclassify a
product like `com.app.lifetime_monthly_promo` as MONTHLY (LIFETIME check runs first
and would catch this one — but the order dependency is invisible). Plan explicitly
asked for "explicit map + throw". The current implementation is "ordered substring
checks + throw", which is functionally similar but more brittle than:

```ts
const PRODUCT_PLAN_MAP: Record<string, SubscriptionPlan> = {
  'com.app.monthly': SubscriptionPlan.MONTHLY,
  ...
};
```

Acceptable for current SKU set, but flag for the next SKU expansion.

### M2 — `revenuecat-rest-client.ts` doesn't sort entitlements when *none* are active

`activeEntries.length === 0` → `primaryActive = null` → `activeProductId = null`.
That's intentional. Just confirming — no bug.

### M3 — `applyRcGroundTruth` writes `appUserId: undefined` on insert path

`subscription.service.ts:632-639` — when creating a new Subscription via cron,
`appUserId` is never set. The webhook `handlePurchaseOrRenewal:265,275` sets it from
`event.original_app_user_id`. Since cron doesn't have an event, this is unavoidable,
but it means rows created by cron have `app_user_id = NULL` until a subsequent
webhook touches them. If anything queries by `appUserId` later, those rows are
invisible. Currently nothing does query by `appUserId`, so no live bug — flag for
future use.

### M4 — Migration test missing

Phase 7 row: "Phase 5 — Migration rename | `app_user_id` column exists, old name
doesn't | Migration test (run + introspect)". No such test exists. Low impact since
TypeORM tracks migration application, but the plan listed it.

---

## Low-Severity Findings

### L1 — Inconsistent log format

Most logs follow `event=X outcome=Y userId=Z`, but a few legacy ones don't:
`subscription.service.ts:281, 326, 355, 386, 397, 416, 438, 528, 643, 654, 659`.
Phase 6 said "incremental adoption is fine", so this is acceptable, but
consistency aids log-based metrics derivation later.

### L2 — `IMMEDIATE_REVOKE_REASONS` declared as array — `O(n)` lookup

`subscription.service.ts:22`: tiny n=2, irrelevant performance, but `Set` reads cleaner
and matches the `SILENT_ACK_EVENTS` style two lines below.

### L3 — `userId.startsWith('$RCAnonymousID:')` filter

`subscription.service.ts:222` — anonymous IDs are filtered out of resolution candidates.
RC docs note `$RCAnonymousID:` is the prefix; lowercase variants like `$rcanonymousid:`
won't match. RC's docs use the canonical capitalisation, so this is fine, but a
defensive `.toLowerCase()` would be cheap insurance.

---

## Backwards Compatibility

- `grep -rn 'revenuecatId\|revenuecat_id' src/ test/` returns only the migration files
  (initial schema and rename) — **clean**.
- DTO `SubscriptionDto` adds an optional `autoResumeAt` field — non-breaking for
  existing API consumers.
- Webhook controller response shape changes from `{status: 'received'}` to
  `{status: 'received', outcome: 'processed'}`. RevenueCat does not parse the body —
  any 2xx is fine — so non-breaking.
- Entity column rename requires the migration to run before code deploys; flagged in
  Phase 5 plan, no action needed beyond deploy discipline.

---

## Build / Type Safety

- `npx tsc --noEmit` → exit 0, clean.
- No new `any` introduced in production code (some `as any` in tests, acceptable).

---

## Test Quality Audit

| File | Quality | Notes |
|---|---|---|
| `db-errors.spec.ts` | Good | Covers happy path + null + non-string code |
| `subscription.service.spec.ts` | Adequate | Heavy mocking, but exercises the right branches |
| `premium.guard.spec.ts` | Good | Cache hit, expiration, eviction all covered |
| `race.integration-spec.ts` | **Inert** | All `it.skip` — fails plan success criteria |
| `subscription-webhook.e2e-spec.ts` | **Tautological** | Tests JS, not the controller |

`subscription.service.spec.ts` is overly mock-heavy — the tests pass payloads through
`processWebhook` but the actual SQL update is asserted via spy on the manager mock.
That's acceptable for unit-level coverage, but combined with C1+C3 means the entire
module has **no** test that exercises the real DB or the real HTTP path.

---

## Recommended Actions (priority order)

1. **(Critical)** Replace `subscription-webhook.e2e-spec.ts` with a real supertest E2E
   that boots the NestJS test module, mounts the controller, and asserts: 401 on bad
   auth, 200+`outcome=stale_dropped` on >24h ts, 200+`outcome=duplicate` on repeat
   eventId, 400 on malformed payload (ValidationPipe).
2. **(Critical)** Either un-skip `race.integration-spec.ts` against a Testcontainers
   PG, or add a CI job that runs it with `DATABASE_URL` pointing to ephemeral PG.
3. **(High)** Make migration up()/down() idempotent with `IF EXISTS` guards (C2).
4. **(Medium)** Add migration introspection test (`describe table → expect column
   app_user_id, no column revenuecat_id`).
5. **(Medium)** Replace substring-based `mapProductToPlan` with explicit object map.
6. **(Low)** Document TRANSFER race-window limitation (H2) and `appUserId` null on
   cron-inserted rows (M3) in the service-level docstring.
7. **(Low)** Standardise remaining log lines to `event=/outcome=` shape.

---

## Positive Observations

- Phase 5/6 production-code changes are tight, well-commented, and map cleanly to
  plan todos.
- The `isUniqueViolation` helper is correctly typed (`unknown` input, no `any` leak)
  and properly used in both call-sites.
- Deterministic `activeProductId` selection with sort + lexical tie-break is cleaner
  than the prior `find()` and well-documented inline.
- EXPIRATION → `plan=FREE` change is the right call; user-visible UI bug from the
  original report is closed.
- Outcome propagation is plumbed end-to-end (service → controller body) with no
  awkward leakage.
- Existing race-condition test scaffolding (even if `.skip`'d) shows correct intent —
  cleanup, real DataSource, parallel `Promise.allSettled`, single-row assert.

---

- **Score: 6/10**
- **Critical: 3** (E2E theater, race tests skipped, migration non-idempotent)
- **High: 3**
- **Request Changes**

Reasoning: production code is solid (8–9/10 on its own merits), but Phase 7 was a
delivered todo and the two highest-value tests are inert. Approving this as-is would
ship Phase 3's lock work and Phase 1's webhook hardening with no automated
regression coverage — defeating the purpose of the test phase. Once C1 and C3 are
addressed (and C2 tightened), this is a clean Approve at 9/10.
