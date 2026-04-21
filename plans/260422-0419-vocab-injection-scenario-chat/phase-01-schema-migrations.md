# Phase 01 — Schema & Migrations

## Context Links

- Brainstorm: `plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md` (§4.2, §4.5, §7 indexes)
- Migration style reference: `src/database/migrations/1775800000000-add-srs-columns-to-vocabulary.ts`, `src/database/migrations/1776100000000-add-onboarding-cache-to-ai-conversations.ts`
- Entity index: `src/database/entities/index.ts`
- DB module: `src/database/database.module.ts`

## Overview

- **Priority:** P1 (blocks all other phases)
- **Status:** done
- **Brief:** Add persistence layer — conversation-level cache column, two performance indexes on `vocabulary`, new `vocabulary_injection_events` table + entity, full registration.

## Key Insights

- `Vocabulary` already has `idx_vocabulary_user_due` on `(user_id, due_at)`. Brainstorm calls for composite indexes on `(user_id, target_lang, last_reviewed_at)` and `(user_id, target_lang, due_at, box)` — neither exists.
- `AiConversation` stores per-conversation state in columns (`metadata` JSONB, `extracted_profile`, `scenarios`). Adding a dedicated `uuid[]` column matches existing pattern (see `scenarios jsonb` column added in `1776100000000`).
- **MUST** register new entity in BOTH `database.module.ts` global `entities` array AND `TypeOrmModule.forFeature([...])` of the module that injects it (per `be_flowering/CLAUDE.md` Railway rule, 2026-03-08 incident).
- Migration timestamp convention: monotonically increasing 13-digit number. Latest is `1778000500000`. Use `1778100000000` + `1778100100000`.

## Requirements

### Functional
- `ai_conversations.injected_vocab_ids` column exists, nullable `uuid[]`, defaults NULL for existing rows.
- `vocabulary_injection_events` table exists with columns per brainstorm §4.5.
- Composite indexes on `vocabulary` for both selection bucket queries.
- `VocabularyInjectionEvent` entity exported from `src/database/entities/index.ts`.
- Registered in `DatabaseModule` global entities.

### Non-Functional
- Migration `up()` + `down()` both idempotent (use `IF NOT EXISTS` / `IF EXISTS`).
- No data loss on rollback for existing `ai_conversations` rows (column add only, drop on down).
- Indexes created `CONCURRENTLY` NOT used — Railway runs migrations in transaction, CONCURRENTLY forbidden.

## Architecture

### Data Flow (this phase)

```
[migration run]
  ├─► ALTER ai_conversations ADD injected_vocab_ids uuid[] NULL
  ├─► CREATE INDEX idx_vocab_user_lang_last_reviewed ON vocabulary(user_id, target_lang, last_reviewed_at)
  ├─► CREATE INDEX idx_vocab_user_lang_due_box ON vocabulary(user_id, target_lang, due_at, box)
  └─► CREATE TABLE vocabulary_injection_events (...)
[app boot]
  └─► DatabaseModule registers VocabularyInjectionEvent → TypeORM metadata loaded
```

## Related Code Files

### Create
- `src/database/migrations/1778100000000-add-vocab-injection-cache-and-indexes.ts`
- `src/database/migrations/1778100100000-create-vocabulary-injection-events-table.ts`
- `src/database/entities/vocabulary-injection-event.entity.ts`

### Modify
- `src/database/entities/ai-conversation.entity.ts` — add `injectedVocabIds?: string[] | null` column mapping
- `src/database/entities/index.ts` — export new entity
- `src/database/database.module.ts` — add new entity to `entities` array

### Delete
- none

## Implementation Steps

1. **Create migration A** `1778100000000-add-vocab-injection-cache-and-indexes.ts`:
   - `up()`:
     ```sql
     ALTER TABLE "ai_conversations" ADD COLUMN "injected_vocab_ids" uuid[] NULL;
     CREATE INDEX IF NOT EXISTS "idx_vocab_user_lang_last_reviewed"
       ON "vocabulary" ("user_id", "target_lang", "last_reviewed_at");
     CREATE INDEX IF NOT EXISTS "idx_vocab_user_lang_due_box"
       ON "vocabulary" ("user_id", "target_lang", "due_at", "box");
     ```
   - `down()`: drop indexes then drop column (reverse order). Use `IF EXISTS`.

2. **Create entity** `src/database/entities/vocabulary-injection-event.entity.ts`:
   - Table: `vocabulary_injection_events`
   - Columns:
     - `id` uuid PK default `gen_random_uuid()` (match existing entity style using `@PrimaryGeneratedColumn('uuid')`)
     - `conversationId` uuid NOT NULL — ManyToOne → `AiConversation` onDelete: CASCADE
     - `vocabularyId` uuid NOT NULL — ManyToOne → `Vocabulary` onDelete: CASCADE
     - `turnIndex` smallint NOT NULL
     - `wasUsed` boolean NOT NULL DEFAULT false
     - `createdAt` timestamptz CreateDateColumn
   - Keep file under 50 lines. No unique constraint — same (conv, vocab) can repeat across turns.

3. **Create migration B** `1778100100000-create-vocabulary-injection-events-table.ts`:
   - `up()`:
     ```sql
     CREATE TABLE "vocabulary_injection_events" (
       "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
       "vocabulary_id" uuid NOT NULL REFERENCES "vocabulary"("id") ON DELETE CASCADE,
       "turn_index" smallint NOT NULL,
       "was_used" boolean NOT NULL DEFAULT false,
       "created_at" timestamptz NOT NULL DEFAULT NOW()
     );
     CREATE INDEX "idx_vocab_inj_events_conv" ON "vocabulary_injection_events" ("conversation_id");
     CREATE INDEX "idx_vocab_inj_events_vocab" ON "vocabulary_injection_events" ("vocabulary_id");
     ```
   - `down()`: `DROP TABLE IF EXISTS "vocabulary_injection_events"` (indexes drop cascade).

4. **Modify entity** `src/database/entities/ai-conversation.entity.ts`:
   - Add column:
     ```ts
     @Column({ type: 'uuid', array: true, name: 'injected_vocab_ids', nullable: true })
     injectedVocabIds?: string[] | null;
     ```
   - Place near other nullable cache columns (`extractedProfile`, `scenarios`).

5. **Update** `src/database/entities/index.ts` — add `export * from './vocabulary-injection-event.entity';`.

6. **Update** `src/database/database.module.ts`:
   - Import `VocabularyInjectionEvent`.
   - Append to `entities` array.

7. **Run migration locally**: `npm run migration:run`. Verify:
   - `\d ai_conversations` shows new column.
   - `\d vocabulary_injection_events` shows table.
   - `\di idx_vocab_user_lang_*` shows both new indexes.

8. **Build check**: `npm run build` — no TS errors.

## Todo List

- [ ] Create migration A (cache column + 2 vocab indexes)
- [ ] Create `VocabularyInjectionEvent` entity
- [ ] Create migration B (events table + indexes)
- [ ] Add `injectedVocabIds` column to `AiConversation` entity
- [ ] Export entity from `database/entities/index.ts`
- [ ] Register entity in `DatabaseModule.entities` array
- [ ] Run `npm run migration:run` successfully
- [ ] Run `npm run build` — no errors
- [ ] Run `psql` verify — both table structures + indexes present

## Success Criteria

- `npm run migration:run` completes without error on fresh DB.
- `npm run migration:revert` cleanly reverses each migration.
- `SELECT injected_vocab_ids FROM ai_conversations LIMIT 1` returns NULL (not error).
- `EXPLAIN SELECT * FROM vocabulary WHERE user_id = ? AND target_lang = ? ORDER BY last_reviewed_at ASC NULLS FIRST LIMIT 5` uses `idx_vocab_user_lang_last_reviewed`.
- `npm run build` passes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Entity registered in only one place → runtime `EntityMetadataNotFoundError` | Med | High | Explicit checklist item for both locations; Railway rule in CLAUDE.md |
| `uuid[]` column unsupported on older PG | Low | High | Supabase PG ≥14 supports natively; project already uses `jsonb` arrays |
| Index bloat on small tables | Low | Low | Indexes are tiny until users accrue >1K vocab; no action needed |
| Migration timestamp collision with in-flight branch | Low | Med | Use `1778100000000`+; verify no existing file with that prefix before commit |

## Security Considerations

- New table FK-cascades to `ai_conversations` and `vocabulary` — user data deletion propagates correctly on account removal.
- No PII in new columns (only UUIDs + booleans).
- RLS: existing `ai_conversations` RLS covers the new column automatically. `vocabulary_injection_events` is analytics-only; RLS not required for MVP (server-side reads only, no client exposure). Revisit if exposed via API.

## Next Steps

- Blocks Phase 02 (service needs entity + repository token).
- Phase 02 will `TypeOrmModule.forFeature([Vocabulary, VocabularyInjectionEvent, AiConversation])` in the scenario-chat module.
