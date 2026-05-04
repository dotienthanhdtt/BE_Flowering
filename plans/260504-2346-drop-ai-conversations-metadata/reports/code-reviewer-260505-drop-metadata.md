# Code Review: Drop ai_conversations.metadata

**Reviewer:** code-reviewer
**Date:** 2026-05-05
**Branch:** dev (uncommitted)
**Scope:** Migration `1780300000000-drop-ai-conversations-metadata.ts` plus entity/service refactors.

## Findings

### CRITICAL

**1. Migration backfill — `(metadata->>'maxTurns')::int` cast crash on legacy rows.**
`src/database/migrations/1780300000000-drop-ai-conversations-metadata.ts:15-19`

The `WHERE scenario_id IS NOT NULL` filter does NOT guarantee `metadata` is non-null or that `metadata->>'maxTurns'` is a valid int. Scenario rows existed before metadata was used to carry `maxTurns`; many will have `metadata = NULL`, `metadata = '{}'::jsonb`, or `metadata->>'maxTurns'` absent. The expression `(metadata->>'maxTurns')::int` evaluates `metadata->>'maxTurns'` first; on `NULL` metadata that returns `NULL` and `COALESCE` saves you. **But** if any historical row has `metadata->>'maxTurns'` set to a non-numeric string (e.g. legacy `"12"` stringified vs. the more dangerous case of any future debug write), the cast throws `invalid input syntax for type integer` and aborts the entire migration. The defensive form is:

```sql
SET "max_turns" = COALESCE(NULLIF(regexp_replace("metadata"->>'maxTurns', '\D', '', 'g'), '')::int, 12)
```

…or simpler: rely on the column DEFAULT 12 already populated in step (a) and just skip the backfill entirely for scenario rows where parsing is uncertain. Given the column already defaults to 12, **the backfill UPDATE is largely cosmetic** — recommend either guarding it (`AND metadata ? 'maxTurns' AND metadata->>'maxTurns' ~ '^\d+$'`) or dropping it.

### HIGH

**2. Migration `down()` is lossy and unsafe.**
`src/database/migrations/1780300000000-drop-ai-conversations-metadata.ts:42-58`

The down migration adds an empty `metadata jsonb` column but does NOT reconstruct `metadata->>'maxTurns'` or `metadata->>'nativeLanguage'` from the now-promoted columns before dropping them. After `down()`, all backfilled data is lost. Worse, the new partial index on `("metadata"->>'completed')::boolean IS DISTINCT FROM true` references a key that no longer exists post-down (because metadata is empty), so every `(user, scenario)` row counts as "active" — duplicate-key violations explode immediately on next INSERT. The previous migration `1779000000000` had the right pattern (rebuild metadata from `status`); this one should mirror it:

```sql
UPDATE "ai_conversations"
SET metadata = COALESCE(metadata, '{}'::jsonb)
  || jsonb_build_object('maxTurns', max_turns)
  || CASE WHEN native_language IS NOT NULL
          THEN jsonb_build_object('nativeLanguage', native_language)
          ELSE '{}'::jsonb END
  || jsonb_build_object('completed', "status" = 'DONE');
```

### MEDIUM

**3. Index swap is a no-op against current state — risk in fresh-DB scenario.**
`src/database/migrations/1780300000000-drop-ai-conversations-metadata.ts:29-36`

Migration `1779000000000` already swapped the index to be keyed on `status = 'CHATTING'`. The new migration drops & recreates it as `status != 'DONE'`. Functionally equivalent given the 2-value enum, **but** confirm enum stays binary going forward — adding a 3rd state (e.g. `PAUSED`) silently changes uniqueness semantics. Recommend an inline comment pinning the invariant.

`DROP INDEX IF EXISTS` is safe on fresh DB ✓. The `type = 'anonymous'` filter in step (c) correctly matches the enum literal value (verified `AiConversationType.ANONYMOUS = 'anonymous'` in entity:15) ✓.

**4. Concurrency — unique index still protects `findOrCreate` race ✓.**
`src/modules/scenario/services/scenario-chat.service.ts:275-303`

Two concurrent first-time inserts both default `status = CHATTING`, both hit the partial unique index on `(user_id, scenario_id) WHERE scenario_id IS NOT NULL AND status != 'DONE'`. One wins, the loser hits `23505` and falls into the retry branch. Behaviorally identical to the old metadata-keyed index. **Edge case:** if user A finishes a conversation (status=DONE) and immediately starts another, the new row with `CHATTING` is unique against any `DONE` row — correct.

**5. Onboarding `complete()` path — `languageId` populated but no `language` relation.**
`src/modules/onboarding/onboarding.service.ts:69-76`

`engine.findConversation()` returns `findOne({ where: { id, type } })` with no `relations`. `conversation.languageId` is a scalar column, so it IS populated. The follow-up `languageRepo.findOne({ where: { id: conversation.languageId } })` is the correct compensating query. **Not** N+1 — one extra round-trip per `complete()` call, fine for an endpoint called once per session. Could optimize to `findOne({ relations: ['language'] })` in the engine OR in `complete()` directly to save 1 query, but YAGNI.

**6. `handleChat()` eager-load is correct ✓.**
`src/modules/onboarding/onboarding.service.ts:45-48` — `relations: ['language']` is well-formed; `language` ManyToOne is non-nullable in entity:39 so guaranteed populated. Called once per turn — no N+1.

### NIT

**7. Test coverage hole — `complete()` cache-hit path doesn't exercise `languageRepo.findOne`.**
`src/modules/onboarding/onboarding.service.spec.ts:448-459` — When `extractedProfile` and `scenarios` are cached, the service still calls `languageRepo.findOne` (line 75) before the cache check (line 79). The mocked `languageRepo.findOne` returns `{id:'lang-en', code:'en'}` so it doesn't break, but no test asserts the call happened or that `language?.id` is forwarded into `getFrameworkCode`. Low risk — current `getFrameworkCode` mock returns `null` so the framework-mapping is bypassed in tests.

**8. Hidden consumers — none found ✓.**
Grep across `src/` confirms no remaining `conversation.metadata` reads/writes outside the migration files. Langfuse/LLM `metadata: {…}` config objects are unrelated to the column ✓. `supabase-initial-schema.sql` still references the column but that's a snapshot file, not active code.

## Summary

- **Blocker:** Migration `down()` is unsafe — fix #2 before merge or document that down is one-way.
- **Should fix before deploy:** #1 — guard the JSON cast or drop the backfill entirely (column DEFAULT already covers it).
- **Defer:** #3 invariant comment, #5 optional eager-load optimization.

## Unresolved Questions

- Is there a runbook/policy stating migrations are forward-only? If yes, #2 downgrades to NIT (just delete the lossy `down()` body and `throw new Error('forward-only')`).
- Are there any pre-prod environments where `metadata` rows might contain non-numeric `maxTurns` (manual debug writes)? Affects #1 severity.
