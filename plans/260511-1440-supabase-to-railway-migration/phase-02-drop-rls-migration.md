# Phase 02 — Drop-RLS migration

**Priority:** high · **Status:** pending · Depends: Phase 01

## Goal
Remove the Supabase-specific RLS policies cleanly via a new TypeORM migration so a
`migration:run` against Railway is green and future fresh-DB setups don't trip on
`auth.uid()`.

## Context
- `src/database/migrations/1706976400000-rls-policies.ts` creates policies using `auth.uid()`. On Railway those `CREATE POLICY` statements fail at restore time (Phase 01) and never get created.
- Two other migrations also add RLS bits: `1740300000000-create-vocabulary-and-add-translation-columns.ts` (vocabulary policy).
- Leave the old migrations **untouched** (history). Add one new migration that idempotently drops everything.

## Steps
0. **[RT] Confirm the "RLS was inert" assumption** before relying on it: the app talks to Postgres via TypeORM as the connection-string role, not via PostgREST. On Supabase that role (`postgres`) has `BYPASSRLS`, so the policies never applied to this app. Quick check on Railway after restore: `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;`. If for some reason the role does *not* bypass RLS and policies somehow exist, the `DISABLE ROW LEVEL SECURITY` in this migration still resolves it — but verify nothing in the app relied on row filtering.
1. Create `src/database/migrations/<timestamp>-drop-supabase-rls.ts`:
   - `up()`: for every table that had RLS — `users`, `user_languages`, `user_progress`, `user_exercise_attempts`, `ai_conversations`, `ai_conversation_messages`, `subscriptions`, `device_tokens`, `refresh_tokens`, `vocabulary` (confirm full list from the two source migrations):
     ```sql
     DROP POLICY IF EXISTS "<policy_name>" ON "<table>";
     ALTER TABLE "<table>" DISABLE ROW LEVEL SECURITY;
     ```
   - `down()`: no-op (or re-enable RLS without policies). Document why — we're not restoring `auth.uid()`-based policies.
2. Keep file under 200 lines; if the policy list is long, loop over an array of `{table, policies[]}`.
3. `npm run build` — confirm compiles.
4. `npm run migration:run` against Railway → expect this migration to apply, all others already marked done.

## Todo
- [ ] Enumerate all RLS policies + tables from existing migrations
- [ ] Write drop-supabase-rls migration (idempotent)
- [ ] `npm run build`
- [ ] `npm run migration:run` clean against Railway
