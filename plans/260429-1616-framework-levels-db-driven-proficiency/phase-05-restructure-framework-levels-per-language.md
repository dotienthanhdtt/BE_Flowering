# Phase 05 — Restructure `framework_levels` to per-language

## Overview
- **Priority:** Critical
- **Status:** pending
- **Effort:** M
- **Depends on:** Phase 04 (already complete)

## Why
- Descriptions must be written in the learning language (e.g., N1 description in Japanese, A1 description in English).
- Current shared-per-framework rows can't carry per-language text.

## Schema target

```
framework_levels
  language_id     UUID        NOT NULL REFERENCES languages(id) ON DELETE CASCADE
  framework_code  VARCHAR(16) NOT NULL    -- kept for onboarding mapping & UI grouping
  level_code      VARCHAR(16) NOT NULL
  description     TEXT        NOT NULL
  order_index     INT         NOT NULL
  PRIMARY KEY (language_id, level_code)
```

`languages.level_framework` → **dropped** (redundant; framework now lives on each row).

## Trigger redesign

```sql
CREATE OR REPLACE FUNCTION user_languages_resolve_level() RETURNS trigger AS $$
BEGIN
  IF NEW.proficiency_level IS NULL THEN
    SELECT level_code INTO NEW.proficiency_level
    FROM framework_levels
    WHERE language_id = NEW.language_id
    ORDER BY order_index ASC LIMIT 1;
    IF NEW.proficiency_level IS NULL THEN
      RAISE EXCEPTION 'No framework_levels seeded for language %', NEW.language_id;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM framework_levels
    WHERE language_id = NEW.language_id AND level_code = NEW.proficiency_level
  ) THEN
    RAISE EXCEPTION 'Invalid level % for language %', NEW.proficiency_level, NEW.language_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

Trigger no longer joins `languages` — `language_id` is on the row.

## Related Code Files
**Create:**
- `src/database/migrations/1779700000000-framework-levels-per-language.ts`

## Migration up steps
1. Backup current `framework_levels` rows into a temp source (CTE or explicit SELECT) keyed by `framework_code`.
2. `DROP TABLE framework_levels CASCADE` (drops trigger dependencies cleanly? — actually trigger references framework_levels via SQL only, no FK; safe to drop the table since trigger function looks it up by name at runtime).
3. `CREATE TABLE framework_levels` with new schema (PK `language_id, level_code`).
4. Fan-out seed:
   ```sql
   INSERT INTO framework_levels (language_id, framework_code, level_code, description, order_index)
   SELECT l.id, l.level_framework, t.level_code,
          'TBD: ' || l.code || ' ' || t.level_code,
          t.order_index
   FROM languages l
   JOIN (VALUES
     ('CEFR','A1',1), ('CEFR','A2',2), ('CEFR','B1',3), ('CEFR','B2',4), ('CEFR','C1',5), ('CEFR','C2',6),
     ('JLPT','N5',1), ('JLPT','N4',2), ('JLPT','N3',3), ('JLPT','N2',4), ('JLPT','N1',5),
     ('HSK','HSK1',1), ('HSK','HSK2',2), ('HSK','HSK3',3), ('HSK','HSK4',4), ('HSK','HSK5',5), ('HSK','HSK6',6),
     ('TOPIK','TOPIK1',1), ('TOPIK','TOPIK2',2), ('TOPIK','TOPIK3',3), ('TOPIK','TOPIK4',4), ('TOPIK','TOPIK5',5), ('TOPIK','TOPIK6',6),
     ('FRAMEWORKLESS','beginner',1)
   ) AS t(framework_code, level_code, order_index) ON t.framework_code = l.level_framework;
   ```
   Description: placeholder `'TBD: <lang_code> <level_code>'` per user (will be edited later).
5. `CREATE OR REPLACE FUNCTION user_languages_resolve_level()` — new body (see above).
6. Trigger itself unchanged (still BEFORE INSERT OR UPDATE OF proficiency_level).
7. `ALTER TABLE languages DROP COLUMN level_framework`.

## Migration down steps
1. `ALTER TABLE languages ADD COLUMN level_framework VARCHAR(16)`.
2. Backfill `level_framework` from any one row per language:
   ```sql
   UPDATE languages l SET level_framework = (
     SELECT framework_code FROM framework_levels WHERE language_id = l.id LIMIT 1
   );
   ALTER TABLE languages ALTER COLUMN level_framework SET NOT NULL;
   ```
3. `DROP TABLE framework_levels CASCADE`.
4. Recreate the old shape from Phase 01 (24 shared rows, framework_code+level_code PK).
5. Restore the old trigger function body (Phase 02 version that reads `languages.level_framework`).

## Todo
- [ ] Migration file with up/down
- [ ] `npm run build` clean
- [ ] `npm run migration:run` succeeds locally
- [ ] psql smoke: `SELECT count(*) FROM framework_levels` matches per-language fan-out (~49 rows)
- [ ] psql smoke: `INSERT INTO user_languages (user_id, language_id) VALUES (...)` fills correct level for each framework
- [ ] psql smoke: invalid level raises P0001

## Success Criteria
- `framework_levels` carries `(language_id, framework_code, level_code, description, order_index)` rows, ~49 total
- `languages` no longer has `level_framework` column
- Trigger validates per `language_id`
- Existing `user_languages` rows untouched

## Risks
- **CASCADE drop of `framework_levels`** — function still references the table by name; recreating it is fine, but watch for any FKs added later.
- **Existing `user_languages` rows** with `proficiency_level` set — if any holds a value not in the new fan-out (shouldn't, since we copy verbatim), trigger will reject *future* updates of those rows. Phase 04's Phase-01 normalization already handled FRAMEWORKLESS legacy 'A1' → 'beginner', so the set should be clean.
- **Backfill collision:** any language with `level_framework` value not in our VALUES list will produce zero rows for that language. Verify before migration: `SELECT DISTINCT level_framework FROM languages` → must be subset of `{CEFR, JLPT, HSK, TOPIK, FRAMEWORKLESS}`.
