# Brainstorm: Auth Improvements + Onboarding Linking

**Date:** 2026-02-24
**Status:** Agreed
**Scope:** Fix 3 critical/high issues in auth module

## Problem Statement

Existing auth + onboarding implementation has 3 significant issues:
1. Refresh token lookup is O(n) bcrypt compares — catastrophic at scale
2. Google OAuth uses web redirect flow — doesn't work for mobile, can't pass sessionToken
3. OAuth email conflict throws error — no account auto-linking

## Issue #1: Refresh Token O(n) Scan (CRITICAL)

### Current Behavior
`refreshTokens()` loads ALL non-revoked tokens from DB, iterates with `bcrypt.compare()`.
At 1000 users × 2 devices = 200s per refresh request.

### Agreed Solution: Composite Token
Format: `{tokenId}:{secret}` where tokenId = UUID, secret = 32 random bytes hex.

**Generation:**
```
tokenId = uuid()
secret = randomBytes(32).hex()
rawToken = `${tokenId}:${secret}`
hash = bcrypt(secret)
store: { id: tokenId, tokenHash: hash, ... }
```

**Verification:**
```
[tokenId, secret] = rawToken.split(':')
storedToken = findOne({ id: tokenId, revoked: false })  // O(1) indexed
isValid = bcrypt.compare(secret, storedToken.tokenHash)  // 1 compare
```

### Changes Required
- `RefreshToken` entity: use tokenId as PK lookup (or add indexed `tokenId` column)
- `generateTokens()`: create composite token
- `refreshTokens()`: split, lookup, compare single
- Migration: add `token_id` column with unique index (if not using PK)

## Issue #2: Google OAuth → Mobile SDK Flow (HIGH)

### Current Behavior
Passport redirect flow (`GET /auth/google` → callback). Mobile apps can't use this. SessionToken can't be passed.

### Agreed Solution: POST /auth/google with idToken
Mirror the Apple flow. Mobile app uses Google Sign In SDK → gets idToken → sends to backend.

**New endpoint:** `POST /auth/google { idToken, displayName?, sessionToken? }`

### Changes Required
- Add `GoogleAuthDto` (idToken, displayName?, sessionToken?)
- Add Google ID token validator using `google-auth-library` (`OAuth2Client.verifyIdToken()`)
- Refactor `GoogleStrategy` or create `GoogleIdTokenStrategy` for server-side validation
- Add `POST /auth/google` to AuthController
- Can keep redirect flow as optional/web fallback or remove it

### Dependencies
- `npm install google-auth-library` (or already available via Google AI deps)

## Issue #3: Auto-Link Accounts (HIGH)

### Current Behavior
User registers with email → later tries Google with same email → `ConflictException`. No account merging.

### Agreed Solution: Provider-Specific ID Columns
Add `googleProviderId` and `appleProviderId` to User entity. Keep `authProvider` as primary method.

### New User Entity Columns
```
google_provider_id  VARCHAR(255)  NULLABLE  UNIQUE
apple_provider_id   VARCHAR(255)  NULLABLE  UNIQUE
```

### OAuth Login Logic (Revised)
```
1. Find by provider-specific ID column → found? Login.
2. Not found → find by email:
   a. Email match → AUTO-LINK: set provider ID on existing user, login.
   b. No match → CREATE new user with provider ID set.
```

### Changes Required
- Migration: add 2 nullable unique columns
- Update User entity
- Refactor `oauthLogin()` and `appleLogin()` to use new columns
- Keep existing `authProvider`/`providerId` for backward compat during transition, or migrate them

### Security Notes
- Auto-link only if email is verified by the OAuth provider (Google/Apple always verify email)
- No auto-link for unverified email scenarios

## Implementation Plan Summary

| # | Task | Effort | Files |
|---|------|--------|-------|
| 1 | Migration: token_id + provider columns | 30m | 1 migration, 2 entities |
| 2 | Refresh token composite format | 30m | auth.service.ts, refresh-token.entity.ts |
| 3 | Google idToken validation endpoint | 45m | google dto, strategy, controller, service |
| 4 | Auto-link OAuth accounts | 30m | auth.service.ts (oauthLogin, appleLogin) |
| 5 | Update tests | 30m | auth.service.spec.ts |
| **Total** | | **~2.5h** | |

## Phase 06 Testing Notes
- Existing onboarding test plan in phase-06 remains valid
- Add tests for: composite token refresh, Google idToken flow, auto-link scenarios
- Test: email user → Google OAuth → same email auto-links
- Test: Google user → Apple OAuth → same email auto-links
- Test: refresh with composite token format

## Risks
- **Migration**: Adding columns is backward compatible (nullable)
- **Refresh token migration**: Existing tokens use old format → must handle gracefully during rollout (check if ':' exists in token, fallback to old scan)
- **Google auth library**: May conflict with existing passport-google-oauth20 — test carefully

## Final Decisions
1. **Remove** Passport redirect Google flow entirely (GoogleStrategy, GoogleAuthGuard, GET endpoints). Only `POST /auth/google` with idToken.
2. **Force logout** all users on deploy — revoke all existing refresh tokens in migration. Clean break, no dual-format code.
3. Migrate existing `authProvider`/`providerId` data to new provider-specific columns in same migration.

## Cleanup: Files to Delete/Modify
- **Delete:** `src/modules/auth/strategies/google.strategy.ts`
- **Delete:** `src/modules/auth/guards/google-auth.guard.ts`
- **Modify:** `auth.module.ts` — remove GoogleStrategy provider, GoogleAuthGuard
- **Modify:** `auth.controller.ts` — remove `GET /auth/google`, `GET /auth/google/callback`
- **Add:** Google ID token validation service (using `google-auth-library`)
- **Add:** `GoogleAuthDto` (idToken, displayName?, sessionToken?)
