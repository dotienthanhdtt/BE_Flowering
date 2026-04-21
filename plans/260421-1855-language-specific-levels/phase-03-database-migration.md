# Phase 3 — Database Migration (Schema + Data Backfill)

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §2, §3
- Prior migration adding learning flags: `src/database/migrations/1740200000000-add-native-learning-flags-to-languages.ts`
- Existing migration naming pattern: Unix-ts-style millis prefix

## Overview
- Priority: P1
- Status: pending
- Effort: 1h
- Brief: Single reversible migration — adds `languages.level_framework`, loosens `user_languages.proficiency_level` column type, drops `proficiency_level_enum`, backfills per-language framework + auto-maps existing user rows.

## Key Insights
- Current seed has 10 learning-available languages; only 8 get a framework (en/es/fr/de/pt → CEFR, ja → JLPT, zh → HSK, ko → TOPIK). vi + th stay NULL despite `is_learning_available=true` (per user directive).
- PostgreSQL `DROP TYPE` must happen AFTER column type change.
- User-level mapping follows brainstorm §3 table exactly. Rows for languages without framework keep existing generic string (no-op).

## Requirements

**Functional**
- `up()`:
  1. Add `level_framework VARCHAR(16) NULL` to `languages`
  2. Set framework per code: `en/es/fr/de/pt=CEFR, ja=JLPT, zh=HSK, ko=TOPIK`
  3. Alter `user_languages.proficiency_level` to `VARCHAR(16)` (was enum)
  4. Drop `proficiency_level_enum`
  5. Backfill existing rows: join user_languages to languages, apply map per framework
- `down()`:
  1. Recreate `proficiency_level_enum` with original 5 values
  2. Inverse-map user rows back to generic (best effort: A1→beginner, A2→elementary, B1→intermediate, B2→upper_intermediate, C1/C2→advanced; JLPT/HSK/TOPIK symmetric)
  3. Alter column back to enum (cast via temp varchar)
  4. Drop `level_framework` column

**Non-functional**
- Single transaction (TypeORM default) — all-or-nothing.
- Idempotent re-run safe: use `IF NOT EXISTS` on column adds, `IF EXISTS` on drops.
- No app downtime required (Railway rolling deploy compatible since column is additive first).

## Architecture
Single TypeORM migration using `queryRunner.query(...)` raw SQL (keeps data migration portable and readable).

## Related Code Files

**Create**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/database/migrations/1778000500000-language-specific-levels.ts`

**Modify**
- None

## Implementation Steps

1. Before starting: run `psql $DATABASE_URL -c "SELECT code, proficiency_level FROM user_languages JOIN languages ON ..."` (spot-check current data shape) — optional but recommended.
2. Create migration file with timestamp `1778000500000` (follows last migration `1778000400000`).
3. `up()` SQL (in order):
   ```sql
   ALTER TABLE languages ADD COLUMN IF NOT EXISTS level_framework VARCHAR(16);
   UPDATE languages SET level_framework='CEFR' WHERE code IN ('en','es','fr','de','pt');
   UPDATE languages SET level_framework='JLPT' WHERE code='ja';
   UPDATE languages SET level_framework='HSK' WHERE code='zh';
   UPDATE languages SET level_framework='TOPIK' WHERE code='ko';

   -- Loosen user_languages.proficiency_level column
   ALTER TABLE user_languages
     ALTER COLUMN proficiency_level TYPE VARCHAR(16)
     USING proficiency_level::text;
   DROP TYPE IF EXISTS proficiency_level_enum;

   -- Backfill user rows per framework
   UPDATE user_languages ul SET proficiency_level = CASE
     WHEN l.level_framework='CEFR' THEN (CASE ul.proficiency_level
       WHEN 'beginner' THEN 'A1' WHEN 'elementary' THEN 'A2'
       WHEN 'intermediate' THEN 'B1' WHEN 'upper_intermediate' THEN 'B2'
       WHEN 'advanced' THEN 'C1' ELSE ul.proficiency_level END)
     WHEN l.level_framework='JLPT' THEN (CASE ul.proficiency_level
       WHEN 'beginner' THEN 'N5' WHEN 'elementary' THEN 'N4'
       WHEN 'intermediate' THEN 'N3' WHEN 'upper_intermediate' THEN 'N2'
       WHEN 'advanced' THEN 'N1' ELSE ul.proficiency_level END)
     WHEN l.level_framework='HSK' THEN (CASE ul.proficiency_level
       WHEN 'beginner' THEN 'HSK1' WHEN 'elementary' THEN 'HSK2'
       WHEN 'intermediate' THEN 'HSK3' WHEN 'upper_intermediate' THEN 'HSK4'
       WHEN 'advanced' THEN 'HSK6' ELSE ul.proficiency_level END)
     WHEN l.level_framework='TOPIK' THEN (CASE ul.proficiency_level
       WHEN 'beginner' THEN 'TOPIK1' WHEN 'elementary' THEN 'TOPIK2'
       WHEN 'intermediate' THEN 'TOPIK3' WHEN 'upper_intermediate' THEN 'TOPIK4'
       WHEN 'advanced' THEN 'TOPIK6' ELSE ul.proficiency_level END)
     ELSE ul.proficiency_level END
   FROM languages l WHERE ul.language_id = l.id AND l.level_framework IS NOT NULL;
   ```
4. `down()` SQL (reverse order):
   ```sql
   -- Inverse-map framework-native → generic
   UPDATE user_languages ul SET proficiency_level = CASE
     WHEN l.level_framework='CEFR' THEN (CASE ul.proficiency_level
       WHEN 'A1' THEN 'beginner' WHEN 'A2' THEN 'elementary'
       WHEN 'B1' THEN 'intermediate' WHEN 'B2' THEN 'upper_intermediate'
       WHEN 'C1' THEN 'advanced' WHEN 'C2' THEN 'advanced'
       ELSE 'beginner' END)
     -- same pattern for JLPT, HSK, TOPIK (see brainstorm §3 inverse)
     ELSE ul.proficiency_level END
   FROM languages l WHERE ul.language_id = l.id;

   CREATE TYPE proficiency_level_enum AS ENUM ('beginner','elementary','intermediate','upper_intermediate','advanced');
   ALTER TABLE user_languages
     ALTER COLUMN proficiency_level TYPE proficiency_level_enum
     USING proficiency_level::proficiency_level_enum;
   ALTER TABLE languages DROP COLUMN IF EXISTS level_framework;
   ```
5. Run against local/dev DB: `npm run migration:run`. Verify:
   - `SELECT code, level_framework FROM languages;` — en/es/fr/de/pt=CEFR, ja=JLPT, zh=HSK, ko=TOPIK, vi=NULL, th=NULL
   - `SELECT DISTINCT proficiency_level FROM user_languages;` — no rows contain `beginner|elementary|intermediate|upper_intermediate|advanced` for framework-bound languages
   - `SELECT COUNT(*) FROM user_languages;` — unchanged from before migration
6. Test rollback: `npm run migration:revert` → re-verify enum restored + sample rows show generic strings.
7. Re-apply: `npm run migration:run`.

## Todo List
- [ ] Snapshot pre-migration row count for `user_languages`
- [ ] Write migration file with `up()` + `down()`
- [ ] Run `npm run migration:run` locally
- [ ] Verify framework backfill on `languages`
- [ ] Verify user level backfill on `user_languages`
- [ ] Verify row count unchanged
- [ ] Test `npm run migration:revert`
- [ ] Re-apply migration

## Success Criteria
- All 8 framework-bound languages have correct `level_framework`.
- vi + th have `level_framework IS NULL`.
- Every user_languages row for framework-bound languages holds a valid framework-native value.
- Row count before == row count after (no data loss).
- Rollback restores enum type + generic strings successfully.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unknown proficiency_level value in prod (not in 5-tier set) | Low | Medium | `ELSE ul.proficiency_level` keeps original string — validator rejects later; manual fix |
| Migration runs partially before crash | Low | High | TypeORM wraps in TX; re-run safe due to IF NOT EXISTS guards |
| Existing RLS policies reference old column type | Low | Medium | Grep `src/database/migrations/1706976100000-rls-policies.ts` — if any reference `proficiency_level_enum`, add RLS patch in this migration |
| down() inverse-map is lossy (C2→advanced, HSK5 unreachable) | Certain | Low (admin-only) | Document in migration header: `down()` is best-effort for admin rollback only |

## Security Considerations
- RLS policies should not break; column rename only (same column name, different type).
- No new PII; `level_framework` is public metadata.

## Next Steps
- Phase 4 updates seed data so fresh DBs get frameworks immediately (migration handles existing DBs only).
