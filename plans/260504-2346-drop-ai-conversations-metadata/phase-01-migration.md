# Phase 01 — Migration: Add Columns, Backfill, Swap Index, Drop Metadata

## Context Links
- `brainstorm-summary.md`
- Existing partial-unique-index migration: `src/database/migrations/1775700100000-add-unique-user-scenario-conversation-index.ts`
- Original metadata column origin: search migrations for `metadata jsonb` on `ai_conversations`.

## Overview
- **Priority:** P1 (gates all code changes)
- **Status:** pending
- **Description:** Single migration that adds `max_turns` + `native_language` columns, backfills both from existing metadata, replaces the partial unique index to key off `status` instead of `metadata.completed`, then drops the `metadata` column.

## Key Insights
- Single migration is acceptable since this stack does deploy-with-downtime / blue-green. Anonymous onboarding sessions are short-lived (<10 min); risk of in-flight loss is low.
- Index swap MUST happen before column drop — order within the migration matters.
- `status` enum is `scenario_chat_status_enum` with values `CHATTING` and `DONE`. Index uses `!= 'DONE'`.

## Requirements
- Idempotent up/down (down restores `metadata` column as JSONB, restores old index — best-effort, data not preserved on down).
- Backfill must run BEFORE column drop, otherwise data is lost.
- Migration name follows existing pattern: `<unix-ms-ish>-drop-ai-conversations-metadata.ts`.

## Architecture
Single TypeORM migration file. No application code changes in this phase.

## Related Code Files
**Create:**
- `src/database/migrations/1778500000000-drop-ai-conversations-metadata.ts`

**Read for context:**
- `src/database/migrations/1775700100000-add-unique-user-scenario-conversation-index.ts` (existing partial index)
- `src/database/entities/ai-conversation.entity.ts` (column types)

## Implementation Steps

1. Create new migration file with timestamp greater than the latest in `src/database/migrations/`. Check max with `ls src/database/migrations/ | sort -n | tail -1`.

2. **Up** in this order:
   ```sql
   -- a. Add new columns
   ALTER TABLE ai_conversations
     ADD COLUMN max_turns int NOT NULL DEFAULT 12,
     ADD COLUMN native_language varchar(10) NULL;

   -- b. Backfill max_turns from metadata for scenario rows
   UPDATE ai_conversations
   SET max_turns = COALESCE((metadata->>'maxTurns')::int, 12)
   WHERE scenario_id IS NOT NULL;

   -- c. Backfill native_language from metadata for anonymous onboarding rows
   UPDATE ai_conversations
   SET native_language = metadata->>'nativeLanguage'
   WHERE type = 'ANONYMOUS' AND metadata ? 'nativeLanguage';

   -- d. Drop old partial unique index (keyed on metadata.completed)
   DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active";

   -- e. Recreate partial unique index keyed on status
   CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
     ON ai_conversations (user_id, scenario_id)
     WHERE scenario_id IS NOT NULL AND status != 'DONE';

   -- f. Drop the metadata column
   ALTER TABLE ai_conversations DROP COLUMN metadata;
   ```

3. **Down** (best-effort restore — data lost):
   ```sql
   ALTER TABLE ai_conversations ADD COLUMN metadata jsonb;

   DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active";
   CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
     ON ai_conversations (user_id, scenario_id)
     WHERE scenario_id IS NOT NULL
       AND (metadata->>'completed')::boolean IS DISTINCT FROM true;

   ALTER TABLE ai_conversations
     DROP COLUMN max_turns,
     DROP COLUMN native_language;
   ```

4. Locally: `npm run migration:run`. Verify with `psql`:
   ```sql
   \d ai_conversations
   SELECT column_name FROM information_schema.columns WHERE table_name='ai_conversations' AND column_name IN ('metadata','max_turns','native_language');
   SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_ai_conversations_user_scenario_active';
   ```

## Todo List
- [ ] Determine next migration timestamp
- [ ] Write `up()` with the 6 steps above
- [ ] Write `down()` for rollback
- [ ] Run migration locally against dev DB
- [ ] Verify columns + index via psql

## Success Criteria
- `\d ai_conversations` shows `max_turns int`, `native_language varchar`, no `metadata`.
- Index definition includes `WHERE scenario_id IS NOT NULL AND status::text <> 'DONE'`.
- All existing scenario rows have `max_turns = 12` (or original metadata value).
- All ANONYMOUS rows that had `metadata.nativeLanguage` now have `native_language` populated.

## Risk Assessment
- **Lost data on rollback** — `metadata` is dropped; rollback can't restore values. Acceptable; no rollback expected.
- **Mid-deploy session loss** — anonymous onboarding sessions in flight when migration runs lose `nativeLanguage` if they predate backfill. Mitigation: backfill happens before drop, so already-persisted rows are migrated. Truly in-flight sessions (mid-request) tolerate it because they re-fetch the row.

## Security Considerations
None. Schema-only change, no auth/data exposure shifts.

## Next Steps
Phase 02 — entity update.
