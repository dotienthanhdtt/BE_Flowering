---
phase: 2
title: "Seed For you + default-category trigger"
status: completed
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Seed "For you" + default-category trigger

## Overview
Seed one `scenario_categories` row per active learning language with `slug='for_you'`. Install PL/pgSQL trigger on `scenarios` BEFORE INSERT/UPDATE OF category_id that auto-defaults NULL `category_id` to the matching-language `for_you` row.

## Requirements
- Functional: every active learning language has exactly one `for_you` row.
- Functional: any `INSERT INTO scenarios` or `UPDATE scenarios SET category_id = NULL` lands in `for_you` of the row's language.
- Non-functional: trigger fails loudly (RAISE EXCEPTION) if no `for_you` row exists for the language — never silently corrupts.

## Architecture

### Seed
```sql
INSERT INTO scenario_categories (id, name, slug, language_id, order_index, is_active)
SELECT gen_random_uuid(),
       CASE l.code
         WHEN 'en' THEN 'For you'
         WHEN 'es' THEN 'Para ti'
         WHEN 'vi' THEN 'Dành cho bạn'
         WHEN 'fr' THEN 'Pour vous'
         WHEN 'de' THEN 'Für dich'
         WHEN 'ja' THEN 'あなたへ'
         WHEN 'ko' THEN '당신을 위한'
         WHEN 'zh' THEN '为你推荐'
         ELSE 'For you'
       END,
       'for_you',
       l.id,
       999,
       true
  FROM languages l
 WHERE l.is_learning_available = true
   AND NOT EXISTS (
     SELECT 1 FROM scenario_categories c
      WHERE c.language_id = l.id AND c.slug = 'for_you'
   );
```
Order index 999 → bottom of list. Translations covered for the languages currently in `languages` table; default English fallback for any future addition.

### Trigger
```sql
CREATE OR REPLACE FUNCTION scenarios_default_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id
      FROM scenario_categories
     WHERE language_id = NEW.language_id
       AND slug = 'for_you'
       AND is_active = true
     LIMIT 1;
    IF NEW.category_id IS NULL THEN
      RAISE EXCEPTION 'No for_you category exists for language_id=%', NEW.language_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scenarios_default_category
BEFORE INSERT OR UPDATE OF category_id ON scenarios
FOR EACH ROW EXECUTE FUNCTION scenarios_default_category();
```

Down migration drops trigger first, then function, then seed rows.

## Related Code Files
- Create: `src/database/migrations/{ts}-seed-for-you-and-default-category-trigger.ts`

## Implementation Steps
1. Confirm `languages.code` column exists and has expected values (`grep` migrations).
2. Confirm `pgcrypto` extension is available (for `gen_random_uuid()`); if not, use `uuid_generate_v4()` or compute UUIDs in JS and pass as parameters.
3. Write seed SQL with `NOT EXISTS` guard (idempotent re-run safe).
4. Write trigger function + trigger creation.
5. Down migration: `DROP TRIGGER`, `DROP FUNCTION`, `DELETE FROM scenario_categories WHERE slug='for_you'` (only if seed rows have no FK references — phase 6 backfill creates them, so down only valid before phase 6 applied; document this constraint).
6. Run `npm run migration:run` on Railway dev.
7. Manual smoke: `INSERT INTO scenarios (language_id, title, type, ...) VALUES (<en-uuid>, 'test', 'system', ...)` without `category_id`; verify row lands with `for_you` `category_id`.
8. Cleanup test insert.

## Success Criteria
- [ ] Exactly one `for_you` row exists per `is_learning_available` language.
- [ ] Trigger fires on INSERT with NULL `category_id` → fills correctly.
- [ ] Trigger raises clear error when no `for_you` row exists for `NEW.language_id`.
- [ ] Migration idempotent (re-running causes no duplicates or errors).
- [ ] All existing tests pass.

## Risk Assessment
- **Risk:** TypeORM repo `.save()` with explicit `category_id: null` triggers the function — desired but may surprise developers. **Mitigation:** document in `CLAUDE.md`.
- **Risk:** Future language added without `for_you` seed → INSERT fails. **Mitigation:** add runbook entry; consider an admin-content guard or another trigger on `languages` insert.
- **Risk:** `pgcrypto` unavailable in some env. **Mitigation:** check Supabase + Railway extensions; fall back to JS-side UUID generation.
- **Risk:** Down migration order incorrect leaves orphan trigger. **Mitigation:** strict reverse order in `down()`.
