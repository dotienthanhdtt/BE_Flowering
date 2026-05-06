---
title: Onboarding-after-login detection on /users/me
status: completed
created: 2026-05-04
completed: 2026-05-04
mode: fast
blockedBy: []
blocks: []
related: [260425-1721-users-me-telemetry-and-shape]
---

# Onboarding-after-login detection on /users/me

**Authoritative spec:** `brainstorm-summary.md` (this directory)

## Summary

Mobile must know right after login whether a user needs to onboard. Backend exposes `onboardingRequired: boolean` + `missingFields: string[]` on `/users/me`. Rule: nativeLanguage missing OR no UserLanguage row OR `onboarding_completed_at IS NULL`. One new column on `users`. No reshape, additive only.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | DB migration + entity (`users.onboarding_completed_at`) + backfill | completed |
| 2 | DTO + service rule + flag-set in onboarding completion paths | completed |
| 3 | Tests + docs + mobile DTO update | completed |

## Key dependencies

- TypeORM/Postgres migration runner (`npm run migration:generate`/`migration:run`)
- Existing `OnboardingService.completeAndExtractProfile` and `AuthService.linkOnboardingSession` — these are the two completion paths that must set the flag
- Existing `UserService.getProfile` — extend to compute and return the flag

## Coordination

`260425-1721-users-me-telemetry-and-shape` reshapes `/users/me` to `{profile, subscription}`. If that plan ships first, the two new fields land inside `profile`. If this plan ships first, they sit at top level and the reshape moves them. Either order works; whichever plan ships second carries the merge work in its phase 2.

## Out of scope

- Re-onboarding flow / `onboarding_status` enum
- Promoting `extracted_profile` jsonb onto `User`
- `POST /users/me` → `GET /users/me` cleanup
