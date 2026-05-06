# Phase 01 — DB migration: drop bool flags, add access_tier enum

## Context Links
- Entity: `src/database/entities/scenario.entity.ts`, `src/database/entities/lesson.entity.ts`
- Existing migrations: `src/database/migrations/1775500000000-create-scenarios-tables.ts`, `1777000500000-add-status-to-content-tables.ts`
- **Historical migrations are frozen — do NOT edit.** Create a new migration file.

## Overview
- **Priority:** P2 (blocker for all downstream phases)
- **Status:** completed
- **Description:** Atomic schema change — drop `is_premium`, `is_trial`, `is_active` on `scenarios` + `lessons`; add `access_tier` enum column. Data preserved via SQL expression.

## Key Insights
- Enum type `access_tier` is new — must `CREATE TYPE ... IF NOT EXISTS` guarded.
- Data mapping (both tables):
  - `access_tier = 'premium'` IF `is_premium = true AND is_trial = false`
  - `access_tier = 'free'` otherwise (covers `is_trial = true` rows — trial collapsed into free)
- Rows with `is_active = false` currently — `is_active` semantic is moving to `status`. Map `is_active = false → status = 'archived'` so those rows remain hidden post-migration.
- Index on `is_active` (name `idx_scenarios_active`) must be dropped explicitly.

## Requirements

### Functional
- Create enum `access_tier` with values `('free', 'premium')`
- Add column `access_tier` (NOT NULL, default `'free'`) to both `scenarios` and `lessons`
- Backfill `access_tier` from old bool cols
- Backfill `status = 'archived'` WHERE `is_active = false` (so inactive rows stay hidden under new model)
- Drop columns `is_premium`, `is_trial`, `is_active` from both tables
- Drop `idx_scenarios_active`
- Add `idx_scenarios_access_tier`, `idx_lessons_access_tier`

### Non-functional
- Reversible `down()` restores original 3 bool cols from `access_tier` + `status`
- Transactional (TypeORM default)
- Idempotent-ish guards (`IF NOT EXISTS` / `IF EXISTS`)

## Architecture

### Data flow (up)
```
Pre: scenarios(is_premium, is_trial, is_active, status)
 1. CREATE TYPE access_tier AS ENUM ('free','premium')
 2. ALTER TABLE ADD COLUMN access_tier NOT NULL DEFAULT 'free'
 3. UPDATE SET access_tier = CASE WHEN is_premium AND NOT is_trial THEN 'premium' ELSE 'free' END
 4. UPDATE SET status = 'archived' WHERE is_active = false AND status = 'published'
 5. DROP INDEX idx_scenarios_active
 6. ALTER TABLE DROP COLUMN is_premium, is_trial, is_active
 7. CREATE INDEX idx_scenarios_access_tier, idx_lessons_access_tier
Post: scenarios(access_tier, status)
```

### Data flow (down)
```
 1. ALTER TABLE ADD COLUMN is_premium BOOL NOT NULL DEFAULT false
                       is_trial   BOOL NOT NULL DEFAULT false
                       is_active  BOOL NOT NULL DEFAULT true
 2. UPDATE SET is_premium = (access_tier = 'premium'),
               is_active = (status <> 'archived')
    (is_trial always restored to false — trial info was already lost on up)
 3. DROP INDEX idx_scenarios_access_tier, idx_lessons_access_tier
 4. ALTER TABLE DROP COLUMN access_tier
 5. DROP TYPE access_tier
 6. Recreate idx_scenarios_active
```

## Related Code Files

**Create:**
- `src/database/migrations/1777001000000-refactor-content-access-tier.ts`

**Read-only reference:**
- `src/database/migrations/1777000500000-add-status-to-content-tables.ts` (pattern for idempotent enum create)
- `src/database/migrations/1775500000000-create-scenarios-tables.ts` (original schema — for `down()` re-creation)

## Implementation Steps

1. Create migration file `1777001000000-refactor-content-access-tier.ts` with class `RefactorContentAccessTier1777001000000`.
2. In `up()`:
   - `CREATE TYPE access_tier AS ENUM ('free','premium')` guarded by `DO $$ ... duplicate_object ... $$`
   - `ALTER TABLE scenarios ADD COLUMN access_tier access_tier NOT NULL DEFAULT 'free'`
   - `ALTER TABLE lessons ADD COLUMN access_tier access_tier NOT NULL DEFAULT 'free'`
   - `UPDATE scenarios SET access_tier = 'premium' WHERE is_premium = true AND is_trial = false`
   - `UPDATE lessons SET access_tier = 'premium' WHERE is_premium = true`
   - `UPDATE scenarios SET status = 'archived' WHERE is_active = false`
   - `UPDATE lessons SET status = 'archived' WHERE is_active = false`
   - `DROP INDEX IF EXISTS idx_scenarios_active`
   - `ALTER TABLE scenarios DROP COLUMN is_premium, DROP COLUMN is_trial, DROP COLUMN is_active`
   - `ALTER TABLE lessons DROP COLUMN is_premium, DROP COLUMN is_active` (lessons has no `is_trial`)
   - `CREATE INDEX idx_scenarios_access_tier ON scenarios(access_tier)`
   - `CREATE INDEX idx_lessons_access_tier ON lessons(access_tier)`
3. In `down()`:
   - Re-add 3 (scenarios) / 2 (lessons) bool cols
   - Backfill from `access_tier` + `status`
   - Drop access_tier index + column
   - `DROP TYPE access_tier`
   - Recreate `idx_scenarios_active`

## Todo List
- [x] Write migration file with kebab-case name `1777001000000-refactor-content-access-tier.ts`
- [x] Verify migration compiles (`npm run build`)
- [x] Dry-run against local DB: `npm run migration:run`
- [x] Verify via `psql`: `\d scenarios`, `\d lessons`, `SELECT DISTINCT access_tier FROM scenarios`
- [x] Test reversibility: `npm run migration:revert` → re-run → inspect

## Success Criteria
- `scenarios` + `lessons` schemas no longer contain `is_premium`, `is_trial`, `is_active`
- Both tables contain `access_tier` enum NOT NULL
- No row has `access_tier IS NULL`
- Previously `is_active = false` rows now have `status = 'archived'`
- `idx_scenarios_access_tier`, `idx_lessons_access_tier` present
- `down()` restores original schema without error

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Enum name collision with existing type | Low | Med | Guard with `DO $$ ... duplicate_object ...` |
| Production data with `is_active = false AND status = 'draft'` accidentally promoted to archived | Med | Low | Update clause filters `WHERE is_active = false` — status stays draft if already draft (no promotion, only archive); re-read: `status = 'archived'` overwrite — acceptable since `is_active=false` == archived intent |
| Index drop leaves query plans slow during up-migration | Low | Low | Same transaction adds new index |
| Trial info permanently lost on `up` | High | Low (product confirmed trial collapses to free) | Document in migration comments |

## Security Considerations
- No RLS policy change — existing policies reference rows not columns; access_tier enforced at service layer

## Next Steps
- Phase 2 consumes the new schema (entity/enum update)
