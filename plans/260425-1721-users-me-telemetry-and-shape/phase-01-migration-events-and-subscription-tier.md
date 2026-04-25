# Phase 1 — DB Migration

**Status:** pending
**Priority:** high
**Effort:** S

## Context

- Spec: `plans/reports/brainstormer-260425-users-me-telemetry-and-shape.md`
- Touches: `subscriptions` table (existing), new `user_device_events` table.

## Goal

Single TypeORM migration that:
1. Creates `user_device_events` table.
2. Adds `tier` column to `subscriptions` with new enum.
3. Adds `PENDING` value to existing `subscriptions_status_enum`.
4. Backfills `subscriptions.tier` from existing data.

## Schema

### `user_device_events`

```sql
CREATE TYPE user_device_events_platform_enum AS ENUM ('IOS','ANDROID');

CREATE TABLE user_device_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform          user_device_events_platform_enum NOT NULL,
  device_model      VARCHAR(120),
  client_timestamp  TIMESTAMPTZ NOT NULL,
  time_zone         VARCHAR(64),
  idfa              VARCHAR(64),
  enable_noti       BOOLEAN NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_device_events_user_created
  ON user_device_events (user_id, created_at DESC);
```

### `subscriptions` delta

```sql
-- 1. Add PENDING to status enum
ALTER TYPE subscriptions_status_enum ADD VALUE IF NOT EXISTS 'pending';

-- 2. Create new tier enum
CREATE TYPE subscriptions_tier_enum AS ENUM ('FREE','TRIAL','PREMIUM','PREMIUM_PLUS');

-- 3. Add tier column
ALTER TABLE subscriptions
  ADD COLUMN tier subscriptions_tier_enum NOT NULL DEFAULT 'FREE';

-- 4. Backfill
UPDATE subscriptions SET tier = 'TRIAL'   WHERE status = 'trial';
UPDATE subscriptions SET tier = 'PREMIUM' WHERE plan IN ('monthly','yearly','lifetime') AND status <> 'trial';
-- FREE remains default for plan='free' rows.
```

## Files

**New:**
- `src/database/migrations/<ts>-add-user-device-events-and-subscription-tier.ts`

## Implementation Steps

1. Generate migration via `npm run migration:generate -- src/database/migrations/AddUserDeviceEventsAndSubscriptionTier` OR hand-write (preferred — `ALTER TYPE ADD VALUE` cannot run inside transaction; needs raw queries with `transaction: false` flag).
2. Write `up()`:
   - `CREATE TABLE user_device_events …`
   - `CREATE INDEX …`
   - `ALTER TYPE subscriptions_status_enum ADD VALUE IF NOT EXISTS 'pending'` (must be outside txn — set `transaction = false` on migration class).
   - `CREATE TYPE subscriptions_tier_enum …`
   - `ALTER TABLE subscriptions ADD COLUMN tier …`
   - Backfill UPDATEs.
3. Write `down()`:
   - `DROP COLUMN tier`, `DROP TYPE subscriptions_tier_enum`.
   - Drop table + index.
   - Note: `ALTER TYPE … DROP VALUE` is NOT supported in Postgres → `down()` leaves `pending` value behind (document this).
4. Run `npm run migration:run` against a dev DB copy.
5. Verify with psql: `\d subscriptions`, `\d user_device_events`, `SELECT DISTINCT tier FROM subscriptions`.

## Todo

- [ ] Write migration file with `transaction = false`
- [ ] up() creates table + index + enum changes + backfill
- [ ] down() reverses table/column/type (document `pending` enum residual)
- [ ] Test on dev DB: migration up → revert → up clean
- [ ] `npm run build` clean

## Success Criteria

- Migration runs without errors on a copy of prod data.
- All existing subscription rows have non-null `tier`.
- `psql -c "SELECT tier, COUNT(*) FROM subscriptions GROUP BY 1"` shows expected distribution.
- `npm run build` passes.

## Risks

- **`ALTER TYPE ADD VALUE` outside transaction** — must set `transaction = false` on migration class or split into two migrations. If forgotten, migration fails on Postgres.
- **Backfill heuristic** — yearly/lifetime users get `PREMIUM` not `PREMIUM_PLUS`. Acceptable per brainstorm; flagged for follow-up.

## Next

Phase 2 — entity + DTO updates that consume new schema.
