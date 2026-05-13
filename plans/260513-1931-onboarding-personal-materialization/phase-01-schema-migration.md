---
phase: 1
title: "Schema Migration"
status: done
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Schema Migration

## Overview
Drop `scenarios.difficulty` column. Drop the orphaned `idx_scenarios_difficulty` index and the `scenario_difficulty` Postgres enum type. Reversible `down()` recreates all three using the original enum (not VARCHAR).

## Requirements
- Functional: `scenarios` table has no `difficulty` column, no `idx_scenarios_difficulty` index; the `scenario_difficulty` enum type is dropped (verified safe — no other tables/views/functions reference it).
- Non-functional: reversible migration; idempotent forward (`IF EXISTS`); idempotent backward (`IF NOT EXISTS` on enum/index recreation).
- Deploy-safe: shipped AFTER code that stops reading `difficulty` (Phase 2 deploys first). Plan-level decision documented in `plan.md`.

## Architecture
TypeORM migration class in `src/database/migrations/`. Raw SQL for type/index management.

## Related Code Files
- Create: `src/database/migrations/1780000000000-drop-scenarios-difficulty.ts`
- Read for reference: `src/database/migrations/1775500000000-create-scenarios-tables.ts` (created enum + index originally — provides authoritative shape for `down()`).
- Read for reference: `src/database/migrations/1778000100000-create-user-ai-scenarios-table.ts` and `1779800100000-merge-user-ai-scenarios-schema-and-backfill.ts` (verify they don't reference the enum after drop).

## Implementation Steps

### MANDATORY PRE-MIGRATION GATES (blocking)
1. Grep `\.difficulty\b` and `difficulty:` across `src/` (excluding migration files and removed test fixtures). Confirm all hits are listed in Phase 2 file list and will be cleaned before Phase 1 deploys. Known consumers (must be removed first):
   - `src/modules/lesson/lesson.service.ts:39, 115`
   - `src/modules/lesson/dto/get-lessons-query.dto.ts` (`level` filter)
   - `src/modules/scenario/services/scenarios-listing.service.ts`
   - `src/modules/scenario/services/scenarios-detail.service.ts`
   - `src/modules/scenario/services/scenarios-redeem.service.ts:61`
   - `src/modules/scenario/dto/redeem-scenario.dto.ts:18`
   - `src/modules/scenario/dto/scenario-default.dto.ts`, `scenario-personal.dto.ts`, `scenario-detail.dto.ts`
   - `src/modules/admin-content/admin-content.service.ts:191`
   - `src/modules/admin-content/prompts/scenario-draft.md`
   - `src/modules/personalization/services/personalization.service.ts:244-252`
   - `src/modules/onboarding/onboarding.service.ts:172-180`
   - `src/database/seeds/scenario-seed-data.ts`
2. Run `psql ... -c "\dT+ scenario_difficulty"` against dev DB. Confirm no columns in OTHER tables use this enum. If any do, halt — separate migration needed first.
3. Confirm `synchronize: false` in `src/database/typeorm-data-source.ts` (standard).

### Migration body
4. Hand-pick timestamp `1780000000000` (greater than highest existing `1779800100000`). Filename: `1780000000000-drop-scenarios-difficulty.ts`. Do NOT use `Date.now()` (collides with existing scheme range).
5. Class `DropScenariosDifficulty1780000000000` implements `MigrationInterface`.
6. `up()`:
   ```sql
   DROP INDEX IF EXISTS idx_scenarios_difficulty;
   ALTER TABLE scenarios DROP COLUMN IF EXISTS difficulty;
   DROP TYPE IF EXISTS scenario_difficulty;
   ```
7. `down()` (restores original shape):
   ```sql
   CREATE TYPE scenario_difficulty AS ENUM ('beginner', 'intermediate', 'advanced');
   ALTER TABLE scenarios ADD COLUMN difficulty scenario_difficulty NOT NULL DEFAULT 'beginner';
   CREATE INDEX IF NOT EXISTS idx_scenarios_difficulty ON scenarios(difficulty);
   ```

### Verification
8. Run `npm run migration:run` on a fresh local DB. Verify:
   - `\d scenarios` → no `difficulty` column.
   - `\di scenarios*` → no `idx_scenarios_difficulty`.
   - `\dT+ scenario_difficulty` → "Did not find any relation."
9. Run `npm run migration:revert`. Verify:
   - `\d scenarios` → `difficulty` column restored, type `scenario_difficulty` (enum), NOT NULL, DEFAULT `'beginner'`.
   - `\di scenarios*` → `idx_scenarios_difficulty` present.
   - `\dT+ scenario_difficulty` → enum with 3 values listed.
10. Re-run `npm run migration:run` → confirms idempotent forward.

## Success Criteria
- [ ] Pre-migration grep gate passed — every `difficulty` consumer is enumerated in Phase 2 file list.
- [ ] `psql \dT+ scenario_difficulty` confirms no external consumers.
- [ ] Migration file uses hand-picked timestamp `1780000000000`.
- [ ] `npm run migration:run` succeeds on clean DB; index + type + column all gone.
- [ ] `npm run migration:revert` cleanly restores all three (enum, column, index) with original types.
- [ ] Idempotent forward (run twice → no error).

## Risk Assessment
- **Risk:** `scenario_difficulty` enum used by an undiscovered view/function. **Mitigation:** mandatory `psql \dT+` pre-check.
- **Risk:** parallel dev-branch migrations on same timestamp. **Mitigation:** hand-picked timestamp; future devs must continue ascending.
- **Risk:** Railway dev DB has rows with `difficulty` set to a non-default value referenced by admin tooling. **Mitigation:** values are not retained post-drop (acceptable since admin tooling is also updated in Phase 2).
- **Risk:** prod deploy of just this migration without Phase 2 code would break prod. **Mitigation:** two-step deploy enforced at plan level; Phase 2 ships first.
