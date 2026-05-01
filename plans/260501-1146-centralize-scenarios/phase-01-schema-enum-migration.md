# Phase 01 — Schema, Enum, Migration

**Priority:** P0 (blocks everything)
**Status:** pending

## Context Links

- `brainstorm-report.md` § Final Schema, § Migration SQL Outline
- `src/database/entities/scenario.entity.ts`
- `src/database/entities/scenario-type.enum.ts`
- `src/database/entities/user-ai-scenario.entity.ts` (to be deleted)

## Overview

Two migrations (Postgres requires `ALTER TYPE ADD VALUE` to commit before use):
1. Enum prep: rename `default` → `system`, add `personal`
2. Schema + backfill + CHECK + drop legacy table

Update entity definitions to match.

A third migration (`1779800200000`) drops the originally planned `source_conversation_id` column — no code path used it (YAGNI).

## Requirements

- Functional: existing scenarios untouched, all `user_ai_scenarios` rows present in `scenarios` with same UUIDs and `type='personal'`.
- Non-functional: migration idempotent (safe to re-run within same Postgres state), down migration restores legacy table.

## Architecture

```
Before:                          After:
scenarios (system + kol)         scenarios (system + kol + personal)
user_ai_scenarios (personal)     [dropped]
```

`ai_conversations.scenario_id` FK → `scenarios(id)` keeps working for personal IDs after backfill.

## Files

**Create:**
- `src/database/migrations/1779800000000-merge-user-ai-scenarios-into-scenarios.ts` (enum prep)
- `src/database/migrations/1779800100000-merge-user-ai-scenarios-schema-and-backfill.ts` (schema + backfill)
- `src/database/migrations/1779800200000-drop-source-conversation-id-from-scenarios.ts` (cleanup)

**Modify:**
- `src/database/entities/scenario-type.enum.ts` — `SYSTEM = 'system'`, add `PERSONAL = 'personal'`
- `src/database/entities/scenario.entity.ts` — add `ownerId`, relax `categoryId` to nullable
- `src/database/database.module.ts` — drop `UserAiScenario` import + array entry
- `src/database/entities/index.ts` — drop `user-ai-scenario.entity` export

**Delete:**
- `src/database/entities/user-ai-scenario.entity.ts`

## Implementation Steps

1. Update `scenario-type.enum.ts`:
   ```ts
   export enum ScenarioType {
     SYSTEM = 'system',
     KOL = 'kol',
     PERSONAL = 'personal',
   }
   ```
2. Update `scenario.entity.ts`:
   - `categoryId?: string` (nullable), `category?: ScenarioCategory`
   - Add `@ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })` `owner?` + `ownerId?`
3. Generate migration files:
   - **Migration 1 (enum prep):** `ALTER TYPE scenario_type RENAME VALUE 'default' TO 'system'`, `ALTER TYPE scenario_type ADD VALUE IF NOT EXISTS 'personal'`
   - **Migration 2 (schema + backfill):**
     - `ALTER TABLE scenarios ALTER COLUMN category_id DROP NOT NULL`
     - Add `owner_id` column with FK
     - `CREATE INDEX idx_scenarios_owner_lang ON scenarios(owner_id, language_id) WHERE type='personal'`
     - Backfill INSERT (see brainstorm § Migration SQL Outline)
     - Add CHECK constraint `scenarios_type_owner_check`
     - `DROP TABLE user_ai_scenarios`
   - **Migration 3 (cleanup):** `ALTER TABLE scenarios DROP COLUMN IF EXISTS source_conversation_id` (drops the unused back-pointer)
   - Run with `npm run migration:run -- --transaction each`
4. Down migration: recreate `user_ai_scenarios`, copy rows back, drop columns/indexes/constraint, rename enum back. Skip `personal` enum value removal (Postgres can't drop enum values cleanly — leave as orphan, harmless).
5. Delete `user-ai-scenario.entity.ts`, update `entities/index.ts`, `database.module.ts`.
6. Run `npm run build` — must pass.
7. Run migration locally against dev DB. Verify counts: `SELECT COUNT(*) FROM scenarios WHERE type='personal'` matches old `user_ai_scenarios` count.

## Todo

- [ ] Update enum
- [ ] Update Scenario entity
- [ ] Write migration up + down
- [ ] Delete UserAiScenario entity + exports
- [ ] `npm run build` passes
- [ ] Run migration on dev DB; verify row count parity
- [ ] Verify CHECK rejects bad insert via psql

## Success Criteria

- Build clean, no TS errors
- Migration runs forward and back cleanly on dev DB
- `SELECT type, COUNT(*), COUNT(owner_id) FROM scenarios GROUP BY type` shows expected partition
- Direct INSERT violating CHECK is rejected by Postgres

## Risks

| Risk | Mitigation |
|---|---|
| `ALTER TYPE ADD VALUE` and use in same transaction fails | Split into two migrations + run with `--transaction each` |
| Backfill overwrites existing `scenarios` row with same UUID | UUID collision astronomically unlikely; add `ON CONFLICT DO NOTHING` for safety |
| FK to `users(id)` cascades unexpectedly | `ON DELETE CASCADE` is intentional — when user deleted, their personal scenarios go too |

## Security

- CHECK constraint prevents schema-level corruption (e.g. personal row without owner)
- No new PII exposure — `owner_id` is internal FK
