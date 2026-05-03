# Phase 3 — Race Conditions (Transactional Locks)

**Issues:** C2 (race in `applyRcGroundTruth`), I7 (equal-timestamp guard), I9 (TRANSFER unique conflict), M6 (`update` by userId silently 0-affected)
**Risk:** High — touches the hottest write path. Concurrency bugs hide in tests.

## Context

- Report §C2, §I7, §I9, §M6
- `subscription.service.ts:482-546` (`applyRcGroundTruth`)
- `subscription.service.ts:194-241` (`handlePurchaseOrRenewal`, ts guard)
- `subscription.service.ts:419-428` (TRANSFER)
- `subscription.service.ts:274-280` (`handleExtension`)

## Requirements

1. **C2 fix:** wrap `applyRcGroundTruth` in `dataSource.transaction(async (mgr) => { ... })`. Inside:
   - `mgr.findOne(Subscription, { where: { userId }, lock: { mode: 'pessimistic_write' } })`
   - If null → `mgr.save(Subscription, newRow)` (unique constraint will surface conflicts).
   - If found → mutate + `mgr.save(Subscription, found)`.
2. **C2 fix (handlePurchaseOrRenewal):** identical lock-on-read pattern. The webhook idempotency transaction already exists (line 87) — extend it: pass the `manager` down to handlers so all reads/writes within one webhook share the same tx + locks.
   - Refactor: change `handlePurchaseOrRenewal(event)` → `handlePurchaseOrRenewal(event, mgr: EntityManager)`. Apply same shape to all dispatch handlers.
3. **I7 fix:** change strict `<` timestamp guard to `<=` in both:
   - `subscription.service.ts:194-198` (in webhook handler stale check)
   - `subscription.service.ts:491` (in `applyRcGroundTruth`)
   - For webhook path, equal-ts collisions are already deduped by event id via `webhook_events`. For applyRcGroundTruth, equal-ts means "same RC view" — `<=` correctly skips redundant work.
4. **I9 fix (TRANSFER):** before `mgr.update(Subscription, { id: source.id }, { userId: toId })`, check `mgr.findOne(Subscription, { where: { userId: toId }, lock: pessimistic_write })`:
   - If exists: log error with both IDs, throw `ConflictException` — webhook tx rolls back, RC retries; loop is documented but bounded by RC's exponential backoff. Alternative escalation path: introduce a `subscription_transfer_conflicts` table for ops review (deferred to follow-up).
5. **M6 fix:** in `handleExtension`, capture `result.affected`; if 0, log warn with userId and the entitlement period that was being extended. No throw — extension on a deleted user is a real edge case.

## Implementation Steps

1. Add `private readonly dataSource: DataSource` injection to `SubscriptionService` constructor (likely already injected; verify).
2. Refactor handler signatures to accept `mgr: EntityManager`. Cascade through dispatch.
3. Replace `subscriptionRepo.findOne(...)` calls inside handlers with `mgr.findOne(Subscription, { ..., lock: { mode: 'pessimistic_write' } })`.
4. Replace `subscriptionRepo.save / update` with `mgr.save / mgr.update`.
5. `applyRcGroundTruth`: wrap entire body in `this.dataSource.transaction(async (mgr) => { ... })`.
6. Update timestamp guard `<` → `<=` in both spots.
7. TRANSFER: add destination-row precheck.
8. `handleExtension`: capture and log affected.

## Files

- Modify: `src/modules/subscription/subscription.service.ts`

## Todo

- [ ] Wire `DataSource` (verify injection)
- [ ] Refactor handlers to accept `EntityManager`
- [ ] Pessimistic locks in `applyRcGroundTruth` and webhook path
- [ ] `<=` timestamp guard
- [ ] TRANSFER destination-conflict precheck
- [ ] `handleExtension` 0-affected log
- [ ] `npm run build` passes
- [ ] Concurrent webhook unit test (Phase 7)

## Success Criteria

- Two concurrent `applyRcGroundTruth` calls for the same user with identical RC payload result in exactly one row, no exception, no duplicate writes.
- Concurrent webhook + cron for the same user serialize via the row lock; later writer sees the earlier writer's state.
- TRANSFER to a user with an existing subscription throws `ConflictException`, webhook retries, idempotency row removed.

## Risks

- Pessimistic locks introduce deadlock potential if any handler also touches `User` or other rows in inverse order. Audit: handlers only touch `subscriptions` and `webhook_events`. webhook_events is inserted first (idempotency wrapper) before any subscription read — consistent order. Low deadlock risk.
- Lock contention under load: each webhook serializes per-user; RC delivers per-user serially in practice. Acceptable.
