# Phase 01 — Migration + Entity + Backfill

**Priority:** High
**Status:** pending
**Effort:** S (~30 min)

## Context Links

- `brainstorm-summary.md` — design rationale
- `src/database/entities/user.entity.ts` — entity to extend
- `src/database/migrations/` — existing migration patterns

## Overview

Add a single nullable `timestamptz` column on `users` that flags whether onboarding chat profile extraction completed. Backfill existing onboarded users so they don't get bounced back to onboarding.

## Requirements

- Column: `users.onboarding_completed_at timestamptz NULL`
- Down migration drops the column cleanly
- Backfill in same migration (up): set `onboarding_completed_at = NOW()` for users where ALL of: `native_language IS NOT NULL`, has at least one `user_languages` row, has at least one `ai_conversations.extracted_profile IS NOT NULL`

## Architecture

Single TypeORM migration. No data duplication — `extracted_profile` jsonb stays on `ai_conversations`. The User column is purely a completion flag.

## Related Code Files

**Modify:**
- `src/database/entities/user.entity.ts` — add `onboardingCompletedAt?: Date | null` field

**Create:**
- `src/database/migrations/<timestamp>-add-onboarding-completed-at.ts`

## Implementation Steps

1. Add field to `User` entity:
   ```ts
   @Column({ type: 'timestamptz', name: 'onboarding_completed_at', nullable: true })
   onboardingCompletedAt?: Date | null;
   ```
2. Generate migration: `npm run migration:generate -- src/database/migrations/AddOnboardingCompletedAt`
3. Edit the generated migration's `up()` to append the backfill SQL after the `ALTER TABLE`:
   ```sql
   UPDATE users SET onboarding_completed_at = NOW()
   WHERE native_language IS NOT NULL
     AND id IN (SELECT DISTINCT user_id FROM user_languages)
     AND id IN (SELECT DISTINCT user_id FROM ai_conversations WHERE extracted_profile IS NOT NULL);
   ```
4. Confirm `down()` only drops the column (do not reverse the backfill — irreversible by design).
5. Run `npm run build` to verify no TS errors.
6. Run `npm run migration:run` against local DB; spot-check with `psql`:
   ```sql
   SELECT COUNT(*) FILTER (WHERE onboarding_completed_at IS NULL) AS pending,
          COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL) AS completed
   FROM users;
   ```

## Todo

- [ ] Add `onboardingCompletedAt` field to `User` entity
- [ ] Generate migration file
- [ ] Add backfill SQL to `up()`
- [ ] `npm run build` clean
- [ ] `npm run migration:run` succeeds locally
- [ ] Spot-check counts via psql

## Success Criteria

- Migration runs forward and reverse without errors
- Existing onboarded users have `onboarding_completed_at` populated post-migration
- Fresh OAuth users have it null
- `User` entity TS compiles

## Risks

| Risk | Mitigation |
|---|---|
| Backfill SQL too aggressive (marks half-onboarded users complete) | Three-AND condition is conservative; only users with all three artifacts get flagged |
| Long-running backfill on large `users` table | Acceptable — migration is one-time. If `users` is millions, wrap in batched UPDATE. Not needed for current scale. |

## Next

Phase 02 — wire flag into `/users/me` and into the two completion paths.
