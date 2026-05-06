# Phase 03 — Tests + Docs + Mobile DTO

**Priority:** High
**Status:** pending
**Effort:** M (~2h)

## Context Links

- `src/modules/user/user.service.spec.ts` (if exists; otherwise create)
- `src/modules/auth/auth.service.spec.ts` — has existing `bootstrapUserLanguage` tests at line ~782
- `src/modules/onboarding/onboarding.service.spec.ts`
- `app_flowering/flowering/lib/features/auth/` — find user profile DTO
- `docs/api-documentation.md`
- `CLAUDE.md` (root) — outdated "anonymous onboarding / in-memory" line

## Overview

Backend test coverage for the new rule + flag-set paths. Update mobile DTO. Sync docs.

## Requirements

### Backend tests

- `UserService.getProfile`:
  - returns `onboardingRequired: true` + 3 missingFields for a bare user
  - returns `onboardingRequired: true` + `["nativeLanguage"]` only when other two satisfied
  - returns `onboardingRequired: false` + empty array when all set
- `OnboardingService` completion path:
  - sets `onboarding_completed_at` when conversation has `userId`
  - does NOT overwrite if already set (idempotency)
  - does nothing when `userId` is null (anonymous session)
- `AuthService.linkOnboardingSession`:
  - sets `onboarding_completed_at` when linked conversation has `extractedProfile`
  - does NOT set when `extractedProfile` is null
  - does NOT overwrite existing timestamp

### Mobile

- Add `onboardingRequired` (bool) and `missingFields` (List<String>) to mobile user profile model
- Post-login routing: if `onboardingRequired` → push onboarding stack; else home
- Remove any client-side null-checking that previously gated onboarding (do not duplicate the rule)

### Docs

- Update `docs/api-documentation.md` — `/users/me` response schema gains two fields
- Update root `CLAUDE.md` — replace stale "no JWT needed; state stored in-memory per sessionId" line to reflect persistence to `ai_conversations` and the new completion flag
- Add a one-liner to `be_flowering/CLAUDE.md` Key Patterns section describing the flag

## Related Code Files

**Modify (backend tests):**
- `src/modules/user/user.service.spec.ts` (create if missing)
- `src/modules/auth/auth.service.spec.ts`
- `src/modules/onboarding/onboarding.service.spec.ts`

**Modify (mobile):**
- `app_flowering/flowering/lib/features/auth/models/user-profile.dart` (or whichever file holds the profile DTO — confirm via grep for `nativeLanguage` in lib/)
- Post-login routing controller in `lib/features/auth/controllers/`

**Modify (docs):**
- `be_flowering/docs/api-documentation.md`
- `be_flowering/CLAUDE.md`
- `CLAUDE.md` (root)

## Implementation Steps

1. Write failing unit tests covering the four scenarios in UserService.
2. Implement until green (mostly already done in Phase 02 — these confirm correctness).
3. Add idempotency tests in OnboardingService + AuthService specs.
4. `npm test` — all green.
5. `npm run lint` clean.
6. Mobile: locate profile DTO via `grep -rn "nativeLanguage" app_flowering/flowering/lib/`. Add two fields with json keys `onboardingRequired`, `missingFields`. Regenerate adapters if Hive is involved (`flutter pub run build_runner build --delete-conflicting-outputs`).
7. Mobile router: gate `Get.offAllNamed(home)` vs `Get.offAllNamed(onboarding)` on the flag.
8. `flutter analyze` clean. `flutter test` green.
9. Update three docs files. Verify no broken cross-references.

## Todo

- [ ] UserService tests (4 scenarios)
- [ ] OnboardingService completion flag tests (3 scenarios)
- [ ] AuthService linkOnboardingSession flag tests (3 scenarios)
- [ ] `npm test` green; `npm run lint` clean
- [ ] Mobile profile DTO updated
- [ ] Mobile post-login routing branches on flag
- [ ] `flutter analyze` + `flutter test` clean
- [ ] `docs/api-documentation.md` updated
- [ ] Root `CLAUDE.md` onboarding paragraph corrected
- [ ] `be_flowering/CLAUDE.md` Key Patterns mentions flag

## Success Criteria

- All backend unit tests pass; coverage on new code ≥80%
- Fresh OAuth user via mobile lands in onboarding stack
- Returning onboarded user lands at home
- No client-side rule duplication remains
- Docs accurately reflect new contract

## Risks

| Risk | Mitigation |
|---|---|
| Mobile DTO change breaks deserialization on older app versions | New fields are nullable on read; fall back to `false`/`[]` if missing |
| Test flakiness on idempotency (clock skew) | Use repository mocks; assert no second update call when timestamp already set |
| Doc drift across two CLAUDE.md files | Cross-link both to brainstorm summary as authoritative spec |

## Security

- Mobile must not trust local cache of `onboardingRequired` across sessions — re-fetch on every login

## Next

Mark plan `completed` after merge. No follow-up phases planned.
