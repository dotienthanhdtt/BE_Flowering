---
phase: 1
title: "Schema: language-scoped categories"
status: completed
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Schema — language-scoped categories

## Overview
Add `slug` + `language_id` to `scenario_categories`, clone existing rows per active language, backfill `scenarios.category_id` to language-matched clones, enforce `UNIQUE(language_id, slug)`. No `for_you` seed yet (phase 2).

## Requirements
- Functional: every existing scenario keeps a valid `category_id` whose `language_id` matches the scenario's `language_id`.
- Non-functional: idempotent migration; safe to re-run on Railway dev; reversible via down migration.

## Architecture

Steps in one migration (transactional):
1. `ALTER TABLE scenario_categories ADD COLUMN slug VARCHAR(64)`.
2. `ALTER TABLE scenario_categories ADD COLUMN language_id UUID REFERENCES languages(id)`.
3. Backfill `slug` from existing `name` (kebab/snake-case helper inline). Example: `Daily life → daily_life`.
4. For each existing global category row, clone once per active learning language (`languages.is_learning_available=true`). Carry: `name`, `order_index`, `is_active`, fresh `slug`, target `language_id`. Insert clones with new UUIDs.
5. Backfill `scenarios.category_id` via join:
   ```sql
   UPDATE scenarios s
      SET category_id = new_cat.id
     FROM scenario_categories old_cat
     JOIN scenario_categories new_cat
       ON new_cat.slug = old_cat.slug
      AND new_cat.language_id = s.language_id
    WHERE s.category_id = old_cat.id
      AND old_cat.language_id IS NULL;
   ```
6. Delete old global rows (`WHERE language_id IS NULL`).
7. `ALTER scenario_categories.language_id SET NOT NULL`.
8. `ALTER scenario_categories.slug SET NOT NULL`.
9. `CREATE UNIQUE INDEX uniq_scenario_category_lang_slug ON scenario_categories(language_id, slug)`.

## Related Code Files
- Create: `src/database/migrations/{ts}-add-language-id-and-slug-to-scenario-categories.ts`
- Modify: `src/database/entities/scenario-category.entity.ts` (add `slug`, `languageId`, `language` relation)

## Implementation Steps
1. Audit current category names → generate stable slug mapping (kebab → snake_case). Document in migration comments.
2. Write migration with `queryRunner.query()` blocks following the SQL above.
3. Update `ScenarioCategory` entity with `slug` (varchar 64, not null) and `languageId` (uuid, not null) + `@ManyToOne(() => Language)` relation.
4. Register entity in `src/database/database.module.ts` global entities array if not already (it is).
5. Run `npm run build` to verify TS compiles.
6. Run migration locally against Railway dev: `npm run migration:run`.
7. Run invariant check:
   ```sql
   SELECT COUNT(*) FROM scenarios s
     JOIN scenario_categories c ON c.id = s.category_id
    WHERE s.language_id <> c.language_id;
   -- must be 0
   ```
8. Manually verify clone count: each old category appears once per `is_learning_available` language.

## Success Criteria
- [ ] Migration runs and reverts cleanly on Railway dev.
- [ ] `scenario_categories.language_id` and `slug` NOT NULL after migration.
- [ ] `UNIQUE(language_id, slug)` enforced.
- [ ] All scenarios still have valid `category_id` post-migration.
- [ ] Invariant query returns 0.
- [ ] `npm run build` passes; `npm test` passes existing scenario specs.

## Risk Assessment
- **Risk:** scenarios with NULL `category_id` (legacy personal) lose mapping during step 5. **Mitigation:** scope of step 5 is `s.category_id = old_cat.id` — NULLs untouched here and handled in phase 6.
- **Risk:** `kol_bundle_scenario` or other tables reference categories. **Mitigation:** audit via `grep -rn "category_id" src/database/migrations` before writing migration; if join tables exist, include them in clone-mapping update.
- **Risk:** A scenario's `language_id` has no matching active language category clone (orphan language). **Mitigation:** pre-flight query `SELECT DISTINCT language_id FROM scenarios WHERE language_id NOT IN (SELECT id FROM languages WHERE is_learning_available)` — fix data before migration.
