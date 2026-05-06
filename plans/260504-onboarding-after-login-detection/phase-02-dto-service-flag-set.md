# Phase 02 — DTO + Service Rule + Set Flag on Completion

**Priority:** High
**Status:** pending
**Effort:** M (~1.5h)

## Context Links

- `src/modules/user/dto/user-profile.dto.ts`
- `src/modules/user/user.service.ts`
- `src/modules/onboarding/onboarding.service.ts`
- `src/modules/auth/auth.service.ts` — `linkOnboardingSession`, `bootstrapUserLanguage`

## Overview

Two parts:
1. **Read path** — extend `UserProfileDto` and `UserService.getProfile` to compute `onboardingRequired` + `missingFields`
2. **Write path** — in both completion code paths, set `users.onboarding_completed_at = NOW()` atomically with the profile extraction

## Requirements

- `UserProfileDto` gains `onboardingRequired: boolean` (required) and `missingFields: string[]` (required, may be empty)
- Rule (server-side, single source of truth):
  - `nativeLanguage` missing → push `"nativeLanguage"`
  - No `user_languages` row for user → push `"userLanguage"`
  - `onboardingCompletedAt IS NULL` → push `"onboardingProfile"`
  - `onboardingRequired = missingFields.length > 0`
- Flag set in:
  - `OnboardingService` — wherever `extracted_profile` is written to the conversation on completion
  - `AuthService.linkOnboardingSession` — when extracted profile is present on the linked conversation
- Both writes idempotent (`COALESCE(onboarding_completed_at, NOW())` semantics — never overwrite)

## Architecture

```
POST /users/me  ──►  UserService.getProfile(userId)
                       ├─ findOne(User)
                       ├─ findOne(UserLanguage where lastLearned=true)  // existing
                       ├─ count(UserLanguage where userId)              // NEW
                       └─ build dto { ...existing, onboardingRequired, missingFields }

POST /onboarding/complete  ──►  OnboardingService
                                  ├─ extract profile, write to ai_conversations.extracted_profile
                                  └─ NEW: userRepo.update(userId, { onboardingCompletedAt: () => 'NOW()' })  if userId present

POST /auth/link-onboarding  ──►  AuthService.linkOnboardingSession
                                  ├─ existing bootstrap nativeLanguage + UserLanguage
                                  └─ NEW: if conversation.extractedProfile, update users.onboarding_completed_at
```

## Related Code Files

**Modify:**
- `src/modules/user/dto/user-profile.dto.ts` — add two fields with `@ApiProperty`
- `src/modules/user/user.service.ts` — extend `getProfile` and `mapToProfileDto`
- `src/modules/onboarding/onboarding.service.ts` — set flag on completion path (search for where `extracted_profile` is persisted)
- `src/modules/auth/auth.service.ts` — extend `linkOnboardingSession` (currently sets `nativeLanguage` at line ~388-393 and bootstraps UserLanguage at ~378)

## Implementation Steps

1. **DTO** — append:
   ```ts
   @ApiProperty({ description: 'True if user must complete onboarding' })
   onboardingRequired!: boolean;

   @ApiProperty({ description: 'Field keys missing for onboarding completion', type: [String] })
   missingFields!: string[];
   ```
2. **UserService.getProfile** — add a `count` on `userLanguageRepo`:
   ```ts
   const userLanguageCount = await this.userLanguageRepo.count({ where: { userId } });
   const missingFields: string[] = [];
   if (!user.nativeLanguage) missingFields.push('nativeLanguage');
   if (userLanguageCount === 0) missingFields.push('userLanguage');
   if (!user.onboardingCompletedAt) missingFields.push('onboardingProfile');
   ```
   Pass into `mapToProfileDto`.
3. **mapToProfileDto** — return the two new fields.
4. **OnboardingService** — locate the completion method (the one that writes `extracted_profile`). After the conversation save, if the conversation has a `userId`, set the flag:
   ```ts
   if (conversation.userId) {
     await this.userRepo.update(
       { id: conversation.userId, onboardingCompletedAt: IsNull() },
       { onboardingCompletedAt: new Date() },
     );
   }
   ```
   Inject `User` repo into `OnboardingService` constructor + `TypeOrmModule.forFeature` in `OnboardingModule`.
5. **AuthService.linkOnboardingSession** — after `bootstrapUserLanguage`, if `conversation.extractedProfile` is non-null:
   ```ts
   await this.userRepository.update(
     { id: userId, onboardingCompletedAt: IsNull() },
     { onboardingCompletedAt: new Date() },
   );
   ```
6. `npm run build` — must pass.
7. Smoke test via Swagger: fresh user → POST /users/me → `onboardingRequired: true`, all 3 missing.

## Todo

- [ ] Extend `UserProfileDto`
- [ ] Update `UserService.getProfile` + `mapToProfileDto`
- [ ] Update `OnboardingModule` (register User repo) and `OnboardingService` (set flag)
- [ ] Update `AuthService.linkOnboardingSession` (set flag)
- [ ] `npm run build` clean
- [ ] Manual swagger smoke test fresh-user + post-onboard

## Success Criteria

- Fresh user (no nativeLanguage, no UserLanguage, no onboarding) → `onboardingRequired: true`, `missingFields: ['nativeLanguage','userLanguage','onboardingProfile']`
- Post `linkOnboardingSession` with extracted profile → `onboardingRequired: false`, `missingFields: []`
- Existing onboarded user (post-backfill) → `onboardingRequired: false`
- Idempotent: calling completion twice does not overwrite the original `onboarding_completed_at` timestamp

## Risks

| Risk | Mitigation |
|---|---|
| `OnboardingService` already injects too many repos | Add only `User` repo. Service stays under 200 lines or split if it crosses |
| `linkOnboardingSession` sets flag even when extracted_profile is null | Guard on `if (conversation.extractedProfile)` before update |
| Race between `/users/me` and completion | Acceptable — eventually consistent on next call |

## Security

- No new authn/authz surface. Flag is per-authenticated-user, returned only via existing JWT-protected endpoint.
- No PII in `missingFields` — opaque keys only.

## Next

Phase 03 — tests, docs, mobile DTO.
