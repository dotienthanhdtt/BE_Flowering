# Phase 01 — Database Schema

## Context Links

- Brainstorm: [../reports/brainstorm-260420-1905-scenario-type-system.md](../reports/brainstorm-260420-1905-scenario-type-system.md) (Data Model Design, Migration Changes)
- Existing: `src/database/migrations/1775500000000-create-scenarios-tables.ts`, `src/database/migrations/1777000600000-add-is-admin-to-users.ts`
- Entities: `src/database/entities/scenario.entity.ts`, `src/database/entities/user.entity.ts`

## Overview

- Priority: P1
- Status: done
- Five new TypeORM migrations + entity updates + `database.module.ts` registration.

## Key Insights

- `scenarios.gift_code` is unused in code (only defined in entity + migration) — safe to drop without code refactor outside this phase.
- `scenarios.creator_id` already exists and stays (nullable).
- `user_ai_scenarios.id` PK reuses the UUID stored inside `ai_conversations.scenarios` JSONB — do **not** use `gen_random_uuid()` default, let app layer supply.
- `kol_bundle_scenarios.scenarioId` is UNIQUE (one scenario per bundle max).
- `user_scenario_access.scenario_id` FK must NOT cascade delete (access preserved when scenario archived) — existing migration has `ON DELETE CASCADE`; need fix or accept existing behavior per brainstorm. **Decision:** alter FK to remove cascade in this phase.
- Register every new entity in BOTH `database.module.ts` global entities array AND the consuming module's `TypeOrmModule.forFeature([...])` — Railway runtime lesson from `CLAUDE.md`.

## Requirements

### Functional

- `scenarios.type` column discriminates `default` | `kol`, NOT NULL, default `default`.
- Existing scenarios backfilled to `type = 'default'` (none are KOL yet).
- `scenarios.gift_code` column removed (and its UNIQUE index).
- `user_ai_scenarios` table created with indexes on `(user_id, language_id)`.
- `kol_bundles` table with UNIQUE `gift_code` (stored uppercase — enforced at app layer; add `CITEXT`? No, app normalizes to keep type simple — YAGNI).
- `kol_bundle_scenarios` join table with composite PK `(bundle_id, scenario_id)` and UNIQUE on `scenario_id`.
- `users.roles text[] NOT NULL DEFAULT ARRAY['user']`.
- Backfill: `UPDATE users SET roles = ARRAY['admin','user'] WHERE is_admin = true`.
- `users.is_admin` column dropped.
- `user_scenario_access.scenario_id` FK changed to `ON DELETE RESTRICT` (or no action) — preserves grant row if scenario archived, since brainstorm requires "no cascade delete".

### Non-Functional

- Migrations run in timestamp order, reversible.
- Down migrations restore prior schema exactly (including `is_admin` bool — copy `'admin' = ANY(roles)` back).

## Architecture

```
scenarios:            + type ('default'|'kol' enum)    - gift_code (drop column + unique idx)
user_ai_scenarios:    NEW (id uuid PK, user_id, language_id, conversation_id, title, description, difficulty, created_at)
kol_bundles:          NEW (id, gift_code UNIQUE, creator_id, title, description, created_at)
kol_bundle_scenarios: NEW (bundle_id, scenario_id UNIQUE, PK(bundle_id,scenario_id))
users:                + roles text[] default ['user']  - is_admin (after backfill)
user_scenario_access: FK scenario_id ON DELETE RESTRICT (was CASCADE)
```

Data flow on scenario archive: existing cascade drops user grants. Changing to RESTRICT means archive requires soft-delete via `status = 'archived'`, which is the existing pattern (ContentStatus enum).

## Related Code Files

### Modify

- `src/database/entities/scenario.entity.ts` — add `type: ScenarioType`, remove `giftCode` field
- `src/database/entities/user.entity.ts` — replace `isAdmin: boolean` with `roles: string[]`
- `src/database/entities/index.ts` — export new entities
- `src/database/database.module.ts` — register `UserAiScenario`, `KolBundle`, `KolBundleScenario`

### Create

- `src/database/entities/scenario-type.enum.ts` (values: `DEFAULT = 'default'`, `KOL = 'kol'`)
- `src/database/entities/user-role.enum.ts` (values: `USER = 'user'`, `ADMIN = 'admin'`, `KOL = 'kol'`)
- `src/database/entities/user-ai-scenario.entity.ts`
- `src/database/entities/kol-bundle.entity.ts`
- `src/database/entities/kol-bundle-scenario.entity.ts`
- `src/database/migrations/1778000000000-add-type-to-scenarios-drop-gift-code.ts`
- `src/database/migrations/1778000100000-create-user-ai-scenarios-table.ts`
- `src/database/migrations/1778000200000-create-kol-bundles-tables.ts`
- `src/database/migrations/1778000300000-replace-is-admin-with-roles.ts`
- `src/database/migrations/1778000400000-relax-user-scenario-access-fk-cascade.ts`

### Delete

- None (superseding existing `is_admin` migration is done via new forward migration, not deletion)

## Implementation Steps

1. Create `scenario-type.enum.ts` and `user-role.enum.ts`.
2. Update `scenario.entity.ts`: add `@Column({ type: 'enum', enum: ScenarioType, default: DEFAULT }) type`; remove `giftCode` field.
3. Update `user.entity.ts`: replace `isAdmin` with `@Column('text', { array: true, default: () => "ARRAY['user']::text[]" }) roles: string[]`.
4. Create `user-ai-scenario.entity.ts` — `id: string` as `@PrimaryColumn('uuid')` (app-supplied), FK relations to User/Language/AiConversation, `difficulty: ScenarioDifficulty`.
5. Create `kol-bundle.entity.ts` — `giftCode` unique, `creatorId` FK User (SET NULL).
6. Create `kol-bundle-scenario.entity.ts` — composite PK via `@Unique(['bundleId','scenarioId'])` with `@PrimaryColumn` on both; add `@Unique` on `scenarioId` alone.
7. Update `entities/index.ts` + `database.module.ts` (add to `entities` array).
8. Migration `1778000000000-add-type-to-scenarios-drop-gift-code.ts`:
   - `CREATE TYPE scenario_type AS ENUM ('default','kol')`
   - `ALTER TABLE scenarios ADD COLUMN type scenario_type NOT NULL DEFAULT 'default'`
   - `UPDATE scenarios SET type = 'default'` (backfill noop — covered by DEFAULT)
   - `ALTER TABLE scenarios DROP COLUMN gift_code` (drops unique idx implicitly)
   - Down: add `gift_code varchar(50) UNIQUE`, drop column+enum
9. Migration `1778000100000-create-user-ai-scenarios-table.ts`:
   - Reuse `scenario_difficulty` enum (already exists)
   - `CREATE TABLE user_ai_scenarios (id UUID PK, user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE, language_id UUID NOT NULL REFERENCES languages ON DELETE CASCADE, conversation_id UUID REFERENCES ai_conversations ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, difficulty scenario_difficulty NOT NULL DEFAULT 'beginner', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
   - `CREATE INDEX idx_user_ai_scenarios_user_lang ON user_ai_scenarios(user_id, language_id)`
   - Down: DROP TABLE
10. Migration `1778000200000-create-kol-bundles-tables.ts`:
    - `CREATE TABLE kol_bundles (id UUID PK DEFAULT gen_random_uuid(), gift_code VARCHAR(50) NOT NULL UNIQUE, creator_id UUID REFERENCES users ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    - `CREATE TABLE kol_bundle_scenarios (bundle_id UUID NOT NULL REFERENCES kol_bundles ON DELETE CASCADE, scenario_id UUID NOT NULL REFERENCES scenarios ON DELETE CASCADE UNIQUE, PRIMARY KEY (bundle_id, scenario_id))`
    - `CREATE INDEX idx_kol_bundles_creator ON kol_bundles(creator_id)`
    - Down: DROP both tables
11. Migration `1778000300000-replace-is-admin-with-roles.ts`:
    - `ALTER TABLE users ADD COLUMN roles text[] NOT NULL DEFAULT ARRAY['user']::text[]`
    - `UPDATE users SET roles = ARRAY['admin','user'] WHERE is_admin = true`
    - `ALTER TABLE users DROP COLUMN is_admin`
    - Down: add `is_admin boolean NOT NULL DEFAULT false`, `UPDATE users SET is_admin = 'admin' = ANY(roles)`, drop `roles`
12. Migration `1778000400000-relax-user-scenario-access-fk-cascade.ts`:
    - `ALTER TABLE user_scenario_access DROP CONSTRAINT user_scenario_access_scenario_id_fkey`
    - `ALTER TABLE user_scenario_access ADD CONSTRAINT user_scenario_access_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE RESTRICT`
    - Down: revert to ON DELETE CASCADE
    - Note: constraint name may differ — query `information_schema.table_constraints` in migration to be safe, or use `pg_get_constraintdef`. Simpler: drop+recreate by querying current name dynamically.
13. Run `npm run build` — compile entity changes.
14. Run `npm run migration:run` locally against a test DB, then `npm run migration:revert` x5 to confirm all down migrations work.

## Todo List

- [x] Add enum files `scenario-type.enum.ts`, `user-role.enum.ts`
- [x] Update `scenario.entity.ts` (add type, remove giftCode)
- [x] Update `user.entity.ts` (isAdmin -> roles)
- [x] Create `user-ai-scenario.entity.ts`
- [x] Create `kol-bundle.entity.ts`
- [x] Create `kol-bundle-scenario.entity.ts`
- [x] Update `entities/index.ts`
- [x] Register entities in `database.module.ts`
- [x] Migration: add type, drop gift_code
- [x] Migration: create user_ai_scenarios
- [x] Migration: create kol_bundles + kol_bundle_scenarios
- [x] Migration: replace is_admin with roles
- [x] Migration: relax user_scenario_access FK cascade
- [x] `npm run build` passes
- [x] `migration:run` + `migration:revert` verified on dev DB

## Success Criteria

- All 5 migrations apply clean on a fresh DB.
- All 5 migrations revert cleanly in reverse order.
- `SELECT type FROM scenarios LIMIT 1` returns `'default'` for all existing rows.
- `SELECT roles FROM users WHERE email = '<known admin>'` returns `{admin,user}`.
- `\d scenarios` confirms no `gift_code` column.
- `\d users` confirms no `is_admin` column, `roles text[]` present.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| FK constraint rename not idempotent across Postgres versions | Med | Med | Drop by current name queried from `pg_constraint`; don't hardcode |
| `is_admin` dropped before all code migrated — runtime crash on SELECT * | High | High | Phase-02 MUST land in same deploy as phase-01; do not split deploys |
| Backfill `roles` missed email with mixed case | Low | Low | Use `ARRAY['admin','user']` for all `is_admin=true` — case insensitive; only checks boolean |
| Existing `user_scenario_access` rows break on FK change | Low | Low | Change is constraint-only; data untouched |
| TypeORM entity/column mismatch in prod (schema drift) | Med | High | Run `migration:run` in Railway pre-deploy; entities registered in `database.module.ts` |

## Security Considerations

- Removing `is_admin` before admin code migrates = permanent admin lockout. Deploy atomically with phase-02.
- `roles text[]` is a trust-boundary column — ensure it is NEVER set from user input anywhere (search before phase-02 completes).

## Next Steps

- Phase-02 unblocks once entities compile; must run in same deploy window.
