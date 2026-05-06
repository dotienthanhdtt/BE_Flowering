# Phase 1 — DB Migration + Entity Update

## Context Links
- Brainstorm: `../reports/brainstorm-260427-0258-translate-chunk-api.md`
- Entity: `src/database/entities/vocabulary.entity.ts`
- Migrations dir: `src/database/migrations/`

## Overview
- **Priority:** P2
- **Status:** complete
- **Effort:** ~30m
Add nullable `type` column (`VARCHAR(30)`) to `vocabulary` table. Update entity. No data backfill needed.

## Key Insights
- Existing `pronunciation` column already exists — no schema change for it.
- Column is nullable so old rows (from `/ai/translate` word path) remain valid.
- Unique constraint `(user_id, word, source_lang, target_lang)` unchanged — same chunk text dedups across sentences.

## Requirements
- `type` column nullable, max 30 chars
- Migration up/down both implemented
- Entity registers field with correct decorator
- Both `database.module.ts` global entities AND `ai.module.ts` `forFeature` already include `Vocabulary` (verified — no module changes)

## Architecture
Single ALTER TABLE. No FK. No index needed in v1 (filtering by type is YAGNI until we ship the "show my idioms" UI).

## Related Code Files
**Modify:**
- `src/database/entities/vocabulary.entity.ts`

**Create:**
- `src/database/migrations/<timestamp>-add-type-to-vocabulary.ts`

## Implementation Steps
1. Add `type` column to entity:
   ```ts
   @Column({ type: 'varchar', length: 30, nullable: true })
   type?: string;
   ```
   Place after `examples` field, before `box` field.
2. Generate migration: `npm run migration:generate -- src/database/migrations/add-type-to-vocabulary -d src/database/typeorm-data-source.ts`
   - If generator misses or duplicates, hand-write the file.
3. Migration content:
   ```ts
   public async up(q: QueryRunner) {
     await q.query(`ALTER TABLE vocabulary ADD COLUMN type VARCHAR(30) NULL`);
   }
   public async down(q: QueryRunner) {
     await q.query(`ALTER TABLE vocabulary DROP COLUMN type`);
   }
   ```
4. Run `npm run migration:run` against local DB.
5. Verify: `psql ... -c "\d vocabulary"` shows `type | character varying(30) | nullable`.

## Todo List
- [x] Add `type` field to `Vocabulary` entity
- [x] Generate or hand-write migration file
- [x] Implement up/down methods
- [x] Run migration locally; verify column exists
- [x] `npm run build` — no TS errors

## Success Criteria
- `\d vocabulary` shows new column
- Existing rows unaffected (`SELECT count(*) FROM vocabulary` unchanged)
- `down` revert leaves schema clean
- Build passes

## Risk Assessment
- **Risk:** Migration generator picks up unrelated entity changes.
  - **Mitigation:** Inspect generated file before commit; trim to only the ALTER TABLE.
- **Risk:** Production DB has long-running transaction that blocks ALTER.
  - **Mitigation:** Adding nullable column is non-blocking on Postgres for normal load. No downtime expected.

## Security Considerations
- No new PII. Column stores enum-like string from LLM output; service layer must whitelist allowed values before insert (handled in Phase 2).

## Next Steps
- Phase 2 consumes this column in upsert.
