# Phase 04: Auto-Link OAuth Accounts

## Context Links
- [Plan overview](plan.md)
- [Brainstorm](../reports/brainstorm-260224-1322-auth-improvements-onboarding-linking.md)
- [auth.service.ts](../../src/modules/auth/auth.service.ts)
- [user.entity.ts](../../src/database/entities/user.entity.ts)

## Overview
- **Priority:** HIGH
- **Status:** completed
- **Description:** Replace ConflictException on email match with auto-linking. Refactor oauthLogin() and appleLogin() to use provider-specific columns.

## Key Insights
- Current flow: find by (authProvider, providerId) → if not found & email exists → ConflictException
- New flow: find by provider-specific column → if not found & email exists → auto-link → login
- Both Google and Apple verify emails — safe to auto-link without additional verification
- `oauthLogin()` and `appleLogin()` have duplicated logic — refactor into single unified method
- Keep `authProvider` column as "primary auth method" (first method used), but all providers can login

## Requirements
### Functional
- Find user by `googleProviderId` or `appleProviderId` (provider-specific lookup)
- If not found, find by email → auto-link (set provider ID on existing user)
- If no email match, create new user with provider ID set
- Support linking multiple providers to same account (email + google + apple)

### Non-functional
- Single DB query for provider lookup (indexed unique column)
- No ConflictException on email match — auto-link instead

## Architecture

**Revised OAuth Login Flow:**
```
1. Find by provider-specific ID column → found? Login.
2. Not found → find by email:
   a. Email match → AUTO-LINK: set provider ID on existing user, login.
   b. No match → CREATE new user with provider ID set.
```

**Unified Method Signature:**
```typescript
async oauthLogin(
  provider: 'google' | 'apple',
  providerUser: { email: string; providerId: string; displayName?: string; avatarUrl?: string },
  sessionToken?: string,
): Promise<AuthResponseDto>
```

## Related Code Files
- **Modify:** `src/modules/auth/auth.service.ts` — refactor `oauthLogin()`, remove `appleLogin()` duplication
- **Modify:** `src/modules/auth/auth.controller.ts` — update apple endpoint to use unified method

## Implementation Steps

1. Refactor `oauthLogin()` in `auth.service.ts`:
   a. Accept `provider: 'google' | 'apple'` parameter
   b. Build dynamic where clause: `{ googleProviderId: providerId }` or `{ appleProviderId: providerId }`
   c. If found → login (generate tokens)
   d. If not found → find by email:
      - If email match → auto-link: `user.googleProviderId = providerId` (or apple), save, login
      - If no match → create new user with provider ID column set
   e. Handle sessionToken linking

2. Remove separate `appleLogin()` method — merge into `oauthLogin()`:
   - `appleLogin()` becomes: validate idToken → call `oauthLogin('apple', appleUser, sessionToken)`
   - `googleLogin()` becomes: validate idToken → call `oauthLogin('google', googleUser, sessionToken)`

3. Update `auth.controller.ts`:
   - Apple endpoint: call `authService.appleLogin()` (which internally calls unified oauthLogin)
   - Google endpoint: call `authService.googleLogin()` (same pattern)

4. Run `npm run build` to verify

## Todo List
- [x] Refactor `oauthLogin()` with provider-specific column lookup
- [x] Implement auto-link logic (set provider ID on existing user)
- [x] Update `appleLogin()` to use unified flow
- [x] Update `googleLogin()` to use unified flow
- [x] Remove `ConflictException` on email match
- [x] Verify build compiles

## Success Criteria
- Email user → Google OAuth same email → auto-links (sets googleProviderId)
- Google user → Apple OAuth same email → auto-links (sets appleProviderId)
- New user with unique email → creates account with provider ID
- Returning OAuth user → finds by provider-specific column → login
- No ConflictException thrown for email matches

## Risk Assessment
- **Race condition:** Two simultaneous OAuth requests for same email could cause conflict — unique constraint handles this gracefully (second request retries)
- **Data integrity:** Only auto-link when OAuth provider verifies email ownership

## Security Considerations
- Auto-link ONLY for verified emails (Google and Apple always verify)
- If a future provider doesn't verify emails, do NOT auto-link
- Unique constraints on provider columns prevent duplicate provider accounts

## Next Steps
- Phase 05 updates all tests to reflect new behavior
