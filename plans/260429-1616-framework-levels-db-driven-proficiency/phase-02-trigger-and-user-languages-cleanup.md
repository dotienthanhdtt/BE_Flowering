# Phase 02 — Trigger + drop `user_languages.proficiency_level` default

## Overview
- **Priority:** Critical
- **Status:** pending
- **Effort:** S
- **Depends on:** Phase 01

## Requirements
- DB trigger fills NULL `proficiency_level` with framework's lowest-order level on INSERT
- Same trigger validates non-NULL values against `framework_levels`
- Drop the `'A1'` default from `user_languages.proficiency_level`; allow NULL on insert (DB fills)

## Implementation Steps
1. New migration `1779600000000-user-languages-level-trigger.ts`
2. Up:
   ```sql
   ALTER TABLE user_languages ALTER COLUMN proficiency_level DROP DEFAULT;
   ALTER TABLE user_languages ALTER COLUMN proficiency_level DROP NOT NULL;
   -- (column may already be NULLable; safe-guard)

   CREATE OR REPLACE FUNCTION user_languages_resolve_level() RETURNS trigger AS $$
   DECLARE fw TEXT;
   BEGIN
     SELECT level_framework INTO fw FROM languages WHERE id = NEW.language_id;
     IF fw IS NULL THEN
       RAISE EXCEPTION 'Language % has no level_framework', NEW.language_id;
     END IF;

     IF NEW.proficiency_level IS NULL THEN
       SELECT level_code INTO NEW.proficiency_level
       FROM framework_levels
       WHERE framework_code = fw
       ORDER BY order_index ASC LIMIT 1;
       IF NEW.proficiency_level IS NULL THEN
         RAISE EXCEPTION 'No framework_levels seeded for %', fw;
       END IF;
     ELSIF NOT EXISTS (
       SELECT 1 FROM framework_levels
       WHERE framework_code = fw AND level_code = NEW.proficiency_level
     ) THEN
       RAISE EXCEPTION 'Invalid level % for framework %', NEW.proficiency_level, fw;
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_user_languages_resolve_level
     BEFORE INSERT OR UPDATE OF proficiency_level ON user_languages
     FOR EACH ROW EXECUTE FUNCTION user_languages_resolve_level();
   ```
3. Down: drop trigger + function; restore default (`SET DEFAULT 'A1'`)
4. Update entity `user-language.entity.ts`: remove `default: 'A1'`, mark TS field as `?: string` (so insert can omit it)
5. Manual smoke test in psql:
   - `INSERT INTO user_languages (user_id, language_id) VALUES (...)` → trigger fills correct level
   - `INSERT … (proficiency_level='ZZZ')` → exception
   - `INSERT … (proficiency_level='A1')` for JLPT lang → exception

## Related Code Files
- Create: `src/database/migrations/1779600000000-user-languages-level-trigger.ts`
- Modify: `src/database/entities/user-language.entity.ts`

## Todo
- [ ] Migration with trigger function
- [ ] Entity default removed; field optional
- [ ] Build passes
- [ ] Migration runs cleanly
- [ ] psql smoke tests pass (3 cases above)

## Success Criteria
- Insert without `proficiency_level` succeeds, value populated correctly per framework
- Invalid level raises `P0001`
- Existing rows untouched

## Risks
- `UPDATE OF proficiency_level` only fires when that column changes — INSERT covers all cases
- Trigger raises uncaught error → currently maps to 500. Phase 04 fixes mapping.
