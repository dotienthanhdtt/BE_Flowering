# Brainstorm Summary — Drop `ai_conversations.metadata` JSONB

**Date:** 2026-05-04
**Outcome:** Approved — Option B (revised)

## Problem

`ai_conversations.metadata` (JSONB, nullable) is being abused as a typed-data escape hatch. Two concrete pain points:

1. **Status drift bug (scenario chat).** `metadata.completed` and `status` enum encode the same fact ("is the conversation finished?") but live in two places. Code set `status = DONE` without setting `metadata.completed = true`, so the partial unique index `UQ_ai_conversations_user_scenario_active` never released the `(user_id, scenario_id)` slot. Result: `findOrCreate()` resurrected DONE conversations and flipped them back to CHATTING.
2. **Untyped JSONB casts everywhere.** Onboarding does `conversation.metadata as Record<string, string>` to read `nativeLanguage` / `targetLanguage`. No compile-time safety.

## Goal

Eliminate the `metadata` JSONB column on `ai_conversations`. Promote real fields to typed columns. Single source of truth for "completed".

## Current `metadata` usage (audit)

| Flow | Key | Replacement |
|------|-----|-------------|
| Scenario chat | `maxTurns` | new column `max_turns int NOT NULL DEFAULT 12` |
| Scenario chat | `completed` | derived: `status != 'DONE'` |
| Onboarding | `targetLanguage` (code) | derive via `languageId` FK → `languages.code` |
| Onboarding | `nativeLanguage` (code) | new column `native_language varchar(10) NULL` |

## Approaches Considered

| | A. Surgical (scenario only) | B. Full eradication (revised) | C. Typed JSONB |
|---|---|---|---|
| Removes JSONB | ❌ kept for onboarding | ✅ dropped | ❌ kept, narrowed |
| Fixes status/completed drift | ✅ | ✅ | ✅ |
| Touches onboarding | ❌ | ✅ | partial |
| Migration size | small | medium | small |
| Future per-type fields | use JSONB | require schema migration | use JSONB |

**Chosen: B revised.** User wants the JSONB column gone. `targetLanguage` is genuinely redundant (derivable from `languageId` join); `nativeLanguage` cannot be derived (anonymous sessions have no `User` row) so it gets a real column.

## Final Design

### Schema changes

```sql
-- 1. Add columns
ALTER TABLE ai_conversations
  ADD COLUMN max_turns int NOT NULL DEFAULT 12,
  ADD COLUMN native_language varchar(10) NULL;

-- 2. Backfill
UPDATE ai_conversations
SET max_turns = COALESCE((metadata->>'maxTurns')::int, 12)
WHERE scenario_id IS NOT NULL;

UPDATE ai_conversations
SET native_language = metadata->>'nativeLanguage'
WHERE type = 'ANONYMOUS' AND metadata ? 'nativeLanguage';

-- 3. Replace partial unique index (status-based, not metadata-based)
DROP INDEX UQ_ai_conversations_user_scenario_active;
CREATE UNIQUE INDEX UQ_ai_conversations_user_scenario_active
  ON ai_conversations (user_id, scenario_id)
  WHERE scenario_id IS NOT NULL AND status != 'DONE';

-- 4. Drop the JSONB column (after code deploy)
ALTER TABLE ai_conversations DROP COLUMN metadata;
```

### Entity changes (`ai-conversation.entity.ts`)

- Remove `metadata?: Record<string, unknown>`.
- Add `maxTurns!: number` (column `max_turns`, default 12).
- Add `nativeLanguage?: string | null` (column `native_language`, varchar(10)).

### Code changes

**`scenario-chat.service.ts`**
- Read `conversation.maxTurns` (not `metadata?.maxTurns`).
- On create, set `maxTurns: MAX_TURNS`.
- Delete `metadata = { ...maxTurns, completed }` writes.
- Response DTO `max_turns` reads from new column.

**`onboarding.service.ts`**
- `startSession()` writes `nativeLanguage: args.nativeLanguage` to column (not metadata). `targetLanguage` is gone (only `languageId` stored).
- `handleChat()`: read `nativeLanguage` from column; resolve `targetLanguage` code via `languageRepo.findOne({ id: conversation.languageId })` or eager `relations: ['language']`.
- `complete()`: same — fetch language by `languageId`, not by `metadata.targetLanguage`.

**`intake-chat-engine.service.ts`**
- Same prompt-var resolution as onboarding (target code via languageId join).

**`auth.service.ts:390-394`**
- Replace `meta.nativeLanguage` with `conversation.nativeLanguage`.

### Tests

- `onboarding.service.spec.ts` — replace `metadata: { nativeLanguage, targetLanguage }` mocks with `nativeLanguage: 'X'` column + `language: { code: 'Y' }` relation. ~10 mock blocks affected.
- `scenario-chat.service.spec.ts` — replace `metadata: { maxTurns }` with `maxTurns` column.
- `auth.service.spec.ts` — verify metadata-based bootstrap still works.

### Two-step deployment (safe)

1. **Deploy code that writes both old `metadata` and new columns**, reads from new columns. Run backfill migration. — *Skip if downtime acceptable.*
2. **Deploy code that drops metadata writes.** Run drop-column migration.

For dev/staging where downtime is fine, can do single-step: add columns + backfill + drop column + code change in one release.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| In-flight anonymous onboarding sessions lose state during deploy | Backfill before drop; deploy during low-traffic window. Anonymous sessions are short-lived (<10 min typical). |
| Test suite breakage from mock churn | Update fixtures in same PR as code change. |
| Engine prompt now does extra DB fetch for target lang code | Use `relations: ['language']` eager load in onboarding repo calls — single query, no N+1. |
| Future per-type fields (e.g. analytics) lose JSONB escape hatch | Accepted trade-off. New fields go through migration — explicit > implicit. |
| Existing DONE rows have `metadata.completed != true` causing unique-index conflict during transition | Switching the index to `status != 'DONE'` happens BEFORE `metadata` drop, so the new index immediately respects DONE rows correctly. No transition gap. |

## Success Criteria

- `metadata` column does not exist on `ai_conversations`.
- All tests pass.
- Scenario chat: starting a fresh conversation after a DONE one produces a new row with status CHATTING (does not resurrect DONE).
- Onboarding: anonymous chat completes and `auth/firebase` flow correctly bootstraps `User.nativeLanguage`.
- `npm run build` clean.
- No `as Record<string,` casts on `conversation.metadata` remain in codebase.

## Files Touched (estimate)

Production:
- `src/database/entities/ai-conversation.entity.ts`
- `src/database/migrations/<new>-drop-ai-conversations-metadata.ts` (new)
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/onboarding/onboarding.service.ts`
- `src/modules/ai/services/intake-chat-engine.service.ts`
- `src/modules/auth/auth.service.ts`

Tests:
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `src/modules/onboarding/onboarding.service.spec.ts`
- `src/modules/auth/auth.service.spec.ts` (if metadata-bootstrapped)

## Next Steps

1. (Optional) Generate detailed implementation plan via `/ck:plan`.
2. Implementation in one PR (single-step migration acceptable for this stack).
3. Manual smoke test: scenario DONE → re-enter → verify new row created. Onboarding → auth → verify `User.nativeLanguage` set.
