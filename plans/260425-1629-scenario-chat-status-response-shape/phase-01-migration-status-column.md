# Phase 01 — Migration: status column + index rebuild

## Context Links
- Brainstorm: `plans/reports/brainstormer-260425-scenario-chat-status-response.md` § A
- Existing partial unique index: `src/database/migrations/1775700100000-add-unique-user-scenario-conversation-index.ts`

## Overview
**Priority:** P1 — blocks every following phase
**Status:** pending
**Effort:** 30 min

Add a real enum column `ai_conversations.status` with values `CHATTING` / `DONE`. Backfill from `metadata->>'completed'`. Drop the legacy `metadata.completed` key. Recreate the partial unique index against `status` instead of `metadata`.

## Key Insights
- `ai_conversations` is shared with onboarding (anonymous) — `status` is benign for those rows; they default to `CHATTING`.
- An existing partial unique index `UQ_ai_conversations_user_scenario_active` predicates on `(metadata->>'completed')::boolean IS DISTINCT FROM true`. **Must be rebuilt** in the same migration; otherwise the index becomes stale once we delete the metadata key.
- One migration file = atomic. Do not split across migrations — leaves DB inconsistent if the second fails.

## Requirements
- New column `status scenario_chat_status NOT NULL DEFAULT 'CHATTING'`.
- Backfill: `DONE` when `metadata->>'completed' = 'true'`, else `CHATTING`.
- Remove `completed` key from `metadata` jsonb.
- Drop + recreate the unique index against `status`.
- Reversible `down()`.

## Architecture
- Migration file in `src/database/migrations/`, timestamp greater than `1778000400000` (latest).
- Use timestamp `1779000000000` (round number, monotonic).
- Class name follows TypeORM convention: `AddStatusToAiConversations1779000000000`.

## Related Code Files
**Create:**
- `src/database/migrations/1779000000000-add-status-to-ai-conversations.ts`

**Read for context:**
- `src/database/migrations/1775700100000-add-unique-user-scenario-conversation-index.ts`

## Implementation Steps

1. Create migration file with this `up()`:
   ```ts
   public async up(qr: QueryRunner): Promise<void> {
     await qr.query(`CREATE TYPE "scenario_chat_status_enum" AS ENUM ('CHATTING', 'DONE')`);

     await qr.query(`
       ALTER TABLE "ai_conversations"
       ADD COLUMN "status" "scenario_chat_status_enum" NOT NULL DEFAULT 'CHATTING'
     `);

     await qr.query(`
       UPDATE "ai_conversations"
       SET "status" = CASE
         WHEN metadata->>'completed' = 'true' THEN 'DONE'::scenario_chat_status_enum
         ELSE 'CHATTING'::scenario_chat_status_enum
       END
     `);

     await qr.query(`UPDATE "ai_conversations" SET metadata = metadata - 'completed' WHERE metadata ? 'completed'`);

     await qr.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);
     await qr.query(`
       CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
         ON "ai_conversations" ("user_id", "scenario_id")
         WHERE "scenario_id" IS NOT NULL AND "status" = 'CHATTING'
     `);
   }
   ```

2. `down()` — reverse order:
   ```ts
   public async down(qr: QueryRunner): Promise<void> {
     await qr.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);

     await qr.query(`
       UPDATE "ai_conversations"
       SET metadata = COALESCE(metadata, '{}'::jsonb) ||
         jsonb_build_object('completed', "status" = 'DONE')
     `);

     await qr.query(`ALTER TABLE "ai_conversations" DROP COLUMN "status"`);
     await qr.query(`DROP TYPE "scenario_chat_status_enum"`);

     await qr.query(`
       CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
         ON "ai_conversations" ("user_id", "scenario_id")
         WHERE "scenario_id" IS NOT NULL
           AND (metadata->>'completed')::boolean IS DISTINCT FROM true
     `);
   }
   ```

3. Run `npm run build` to confirm the migration compiles.
4. Run `npm run migration:run` against a local/staging DB (NOT prod). Verify:
   - `\d ai_conversations` shows the new column.
   - Sample rows have `status` populated correctly.
   - `metadata` no longer has `completed`.
   - Index `UQ_ai_conversations_user_scenario_active` exists with new predicate.
5. Run `npm run migration:revert` and confirm the original index predicate restored. Then re-run.

## Todo List
- [ ] Create migration file with both up/down
- [ ] `npm run build` passes
- [ ] Local migration run + revert + re-run confirmed
- [ ] Verify partial unique index uses `status = 'CHATTING'`
- [ ] Verify metadata no longer contains `completed` key

## Success Criteria
- `ai_conversations.status` column exists with correct enum.
- Backfill matches old `metadata.completed`.
- Index predicate references `status`.
- `down()` is round-trip safe.

## Risk Assessment
- **Risk:** Long-running UPDATE on large tables. **Mitigation:** Table is small (single-app, scenario chat usage); acceptable. If row count > 100k in future, switch to batched update.
- **Risk:** Concurrent writes during migration. **Mitigation:** Migration runs in single transaction by default; deploy during low-traffic window.

## Security Considerations
- No data exposure changes. Column is internal.

## Next Steps
- Phase 02 updates the entity to read the new column.
