# Phase 01 — Create `framework_levels` table & seed

## Overview
- **Priority:** Critical (foundation for trigger)
- **Status:** pending
- **Effort:** S

## Requirements
- New table `framework_levels` with composite PK `(framework_code, level_code)`
- Seed all current frameworks: CEFR (6), JLPT (5), HSK (6), TOPIK (6), FRAMEWORKLESS (1×`beginner`)
- Backfill `languages.level_framework='FRAMEWORKLESS'` where NULL; make column NOT NULL

## Architecture
```
framework_levels
----------------
framework_code  VARCHAR(16)  NOT NULL
level_code      VARCHAR(16)  NOT NULL
description     TEXT         NOT NULL
order_index     INT          NOT NULL
PRIMARY KEY (framework_code, level_code)
```

## Related Code Files
- Create: `src/database/migrations/1779500000000-create-framework-levels-table.ts`
- Create: `src/database/entities/framework-level.entity.ts`
- Modify: `src/database/database.module.ts` (register entity)

## Implementation Steps
1. Write migration up:
   - `CREATE TABLE framework_levels (...)`
   - `INSERT INTO framework_levels` rows from `LANGUAGE_FRAMEWORKS` constant. Use `'TBD: <framework> <level>'` placeholder description for now (open item #1)
   - `UPDATE languages SET level_framework='FRAMEWORKLESS' WHERE level_framework IS NULL`
   - `ALTER TABLE languages ALTER COLUMN level_framework SET NOT NULL`
2. Write migration down (reverse all of above; restore NULLable framework)
3. Create `FrameworkLevel` entity (composite PK via `@PrimaryColumn` × 2)
4. Register entity in `database.module.ts` global entities array
5. `npm run build` to verify

## Todo
- [ ] Migration file with up/down
- [ ] Seed all 24 framework_levels rows
- [ ] Backfill + NOT NULL on `languages.level_framework`
- [ ] `FrameworkLevel` entity
- [ ] Entity registered in `DatabaseModule`
- [ ] Build passes
- [ ] `npm run migration:run` against local DB succeeds

## Success Criteria
- `SELECT count(*) FROM framework_levels` returns 24
- `SELECT count(*) FROM languages WHERE level_framework IS NULL` returns 0
- TypeORM build clean

## Risks
- Existing `user_languages` rows already have valid framework levels — no data loss expected
- vi/th users currently have arbitrary `proficiency_level` values (not validated before this); seed `FRAMEWORKLESS.beginner` should match what's there. **Verify before migration:** `SELECT DISTINCT proficiency_level FROM user_languages ul JOIN languages l ON ul.language_id=l.id WHERE l.level_framework IS NULL`
