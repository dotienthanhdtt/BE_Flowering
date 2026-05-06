# Phase 5 — Important Correctness Fixes

**Issues:** I2, I4, I5, I8, I11
**Risk:** Low — localized changes, mostly normalization.

## Context

- Report §I2, §I4, §I5, §I8, §I11

## Requirements

1. **I2 — `mapProductToPlan` no silent default.** Replace fallback-to-`MONTHLY` with explicit map + throw on unknown. The throw bubbles up the webhook tx; idempotency rolls back, RC retries, on-call sees the alert. Add a structured `error` log with `productId` so ops can extend the map.
2. **I4 — EXPIRATION normalization.** After EXPIRATION, set `plan = FREE` (or null, depending on enum) and clear `currentPeriodEnd` (set to the same expiry timestamp is fine; the issue is `mapToDto` exposes a stale "YEARLY" plan with isActive=false — confusing UI). Pick: keep `currentPeriodEnd` historical; set `plan = FREE`.
3. **I5 — Cron pagination & ordering.** Already partly addressed in Phase 2 (added `order` clause). This phase: if candidate count == BATCH_SIZE, schedule a follow-up run (e.g. emit `setImmediate` or rely on next cron tick — document choice). Lightweight: add a `warn` log when batch is full so ops can surface it. Defer cursor-paging unless logs show backlog.
4. **I8 — Rename `revenuecatId`.** Rename column to `appUserId` to reflect actual content (RC's `original_app_user_id`). Migration required:
   - Generate TypeORM migration: `RENAME COLUMN revenuecat_id TO app_user_id`.
   - Update entity property + all references.
   - Verify Swagger / DTO not exposed externally with the old name (grep shows it's internal-only).
5. **I11 — Persist `auto_resume_at_ms` on PAUSE.** Add column `autoResumeAt: Date | null` on `Subscription` entity. Migration adds nullable timestamptz. PAUSE handler captures from event. Expose via `mapToDto` as ISO string.

## Implementation Steps

1. `subscription.service.ts:436-442` — replace mapping with explicit object lookup; throw `Error('Unknown product: ' + productId)` on miss; log structured `error`.
2. `subscription.service.ts:325-341` — set `plan: SubscriptionPlan.FREE` in EXPIRATION update payload.
3. `cron/subscription-reconciliation.cron.ts` — add `if (candidates.length === BATCH_SIZE) this.logger.warn('reconcile batch full, possible backlog')`.
4. Generate migration: `npm run migration:generate -- src/database/migrations/RenameRevenuecatIdAndAddAutoResume`. Migration:
   ```ts
   ALTER TABLE subscriptions RENAME COLUMN revenuecat_id TO app_user_id;
   ALTER TABLE subscriptions ADD COLUMN auto_resume_at TIMESTAMPTZ NULL;
   ```
   Down: reverse both.
5. `database/entities/subscription.entity.ts`:
   - Rename `revenuecatId` → `appUserId`, update `@Column({ name: 'app_user_id' })`.
   - Add `autoResumeAt?: Date | null` with `@Column({ name: 'auto_resume_at', type: 'timestamptz', nullable: true })`.
6. `subscription.service.ts:364-377` (PAUSE handler) — capture `event.auto_resume_at_ms` and set `autoResumeAt: ms ? new Date(ms) : null`.
7. `dto/subscription.dto.ts` — expose `autoResumeAt` as ISO string in `mapToDto` if pause UI needs it; otherwise leave for follow-up.

## Files

- Modify: `src/modules/subscription/subscription.service.ts`
- Modify: `src/modules/subscription/cron/subscription-reconciliation.cron.ts`
- Modify: `src/database/entities/subscription.entity.ts`
- New: `src/database/migrations/{timestamp}-RenameRevenuecatIdAndAddAutoResume.ts`
- Modify: `src/modules/subscription/dto/subscription.dto.ts` (if exposing autoResumeAt)

## Todo

- [ ] Strict product-to-plan mapping
- [ ] EXPIRATION sets plan=FREE
- [ ] Cron full-batch warning
- [ ] Generate + apply migration (rename column, add autoResumeAt)
- [ ] Update entity + service references
- [ ] PAUSE persists autoResumeAt
- [ ] `npm run build` + `npm run migration:run` (against dev DB) pass

## Success Criteria

- Webhook with unknown product ID throws → logged → RC retries; no silent MONTHLY grant.
- After EXPIRATION, `mapToDto` returns `plan: 'FREE'`.
- PAUSE event with `auto_resume_at_ms` populates `auto_resume_at` column.
- DB column renamed cleanly with no broken references (test: `grep -r revenuecatId src/` returns 0).

## Risks

- Migration rename: production deploys must run the migration before code that references `appUserId` runs. Standard NestJS migration discipline applies; flag in PR description.
