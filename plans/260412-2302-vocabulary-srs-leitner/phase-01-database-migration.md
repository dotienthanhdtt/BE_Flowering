# Phase 01: Database Migration + Entity SRS Fields

## Context Links
- Brainstorm: `plans/reports/brainstorm-260412-2302-vocabulary-srs-leitner.md`
- Entity: `src/database/entities/vocabulary.entity.ts`
- Existing migrations: `1740300000000` (create vocab), `1740400000000` (add definition/examples)

## Overview
- Priority: P1
- Status: pending
- Effort: S (30m)

Add 5 Leitner SRS columns to `vocabulary` + index on `(user_id, due_at)`. Backfill existing rows.

## Key Insights

- Existing unique constraint `(userId, word, sourceLang, targetLang)` stays intact.
- `TranslationService.translateWord()` uses `orUpdate` with specific columns — new SRS columns NOT in conflict set, so existing upsert path untouched. New rows get entity defaults; existing rows get backfill.
- Index must support due-query: `WHERE user_id = ? AND due_at <= NOW() ORDER BY due_at ASC`.

## Requirements

**Functional**
- All 5 columns NOT NULL with sane defaults.
- Backfill existing rows: `box=1, due_at=NOW()`.
- Index on `(user_id, due_at)` for fast due-scan.

**Non-functional**
- Migration idempotent where possible.
- Down migration reverses cleanly.

## Architecture

### Columns
```sql
ALTER TABLE vocabulary
  ADD COLUMN box smallint NOT NULL DEFAULT 1,
  ADD COLUMN due_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN last_reviewed_at timestamptz NULL,
  ADD COLUMN review_count int NOT NULL DEFAULT 0,
  ADD COLUMN correct_count int NOT NULL DEFAULT 0;

-- Backfill pre-existing rows already covered by DEFAULTs above since NOT NULL.
-- But explicit set for clarity on existing rows:
UPDATE vocabulary SET box=1, due_at=NOW() WHERE box IS NULL; -- no-op with NOT NULL DEFAULT, safe

CREATE INDEX idx_vocabulary_user_due ON vocabulary(user_id, due_at);
```

Box range guard: add CHECK constraint `box BETWEEN 1 AND 5`.

## Related Code Files

**Modify**
- `src/database/entities/vocabulary.entity.ts` — add 5 fields with decorators + defaults

**Create**
- `src/database/migrations/{timestamp}-add-srs-columns-to-vocabulary.ts`

## Implementation Steps

1. Update entity:
```ts
@Column({ type: 'smallint', default: 1 })
box!: number;

@Column({ name: 'due_at', type: 'timestamptz', default: () => 'NOW()' })
dueAt!: Date;

@Column({ name: 'last_reviewed_at', type: 'timestamptz', nullable: true })
lastReviewedAt?: Date | null;

@Column({ name: 'review_count', type: 'int', default: 0 })
reviewCount!: number;

@Column({ name: 'correct_count', type: 'int', default: 0 })
correctCount!: number;
```

2. Generate migration: `npm run migration:generate -- src/database/migrations/add-srs-columns-to-vocabulary`

3. Edit migration to include CHECK + index:
```ts
await queryRunner.query(`ALTER TABLE vocabulary ADD CONSTRAINT vocabulary_box_check CHECK (box BETWEEN 1 AND 5)`);
await queryRunner.query(`CREATE INDEX idx_vocabulary_user_due ON vocabulary(user_id, due_at)`);
```

4. Down migration drops index → constraint → columns.

5. Run locally: `npm run migration:run`.

6. Verify in psql:
```sql
\d vocabulary
\di idx_vocabulary_user_due
SELECT box, due_at FROM vocabulary LIMIT 3;
```

7. `npm run build` clean.

## Todo List

- [ ] Add 5 SRS fields to `vocabulary.entity.ts`
- [ ] Generate migration
- [ ] Add CHECK constraint + index to migration manually
- [ ] Write down migration
- [ ] Run migration locally, verify columns + index in psql
- [ ] `npm run build` passes
- [ ] Test `POST /ai/translate` with existing user — row gets `box=1, due_at=NOW` via default

## Success Criteria

- `\d vocabulary` shows all 5 new columns with correct types + defaults
- `\di` shows `idx_vocabulary_user_due`
- CHECK constraint exists on `box`
- Existing vocab rows have `box=1, due_at` populated
- Regression: translate-word still works end-to-end

## Risk Assessment

| Risk | Mitigation |
|---|---|
| NOT NULL DEFAULT blocks migration on large tables | PG handles DEFAULT at migration time efficiently (stored once, applied virtually). Safe. |
| Auto-save path breaks | `orUpdate` in TranslationService targets specific columns — verify new columns NOT in conflict list. |
| Index bloat on writes | Single composite index; write cost acceptable for read benefit. |

## Security Considerations
- No new attack surface — columns are SRS state only.
- RLS policy already covers `vocabulary` table per user_id.

## Next Steps
- Phase 02: Build CRUD service + controller using new fields.
