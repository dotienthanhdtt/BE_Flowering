# Phase 05: Update Tests

## Context Links
- [Plan overview](plan.md)
- [auth.service.spec.ts](../../src/modules/auth/auth.service.spec.ts)

## Overview
- **Priority:** HIGH
- **Status:** completed
- **Description:** Update existing tests and add new tests for composite token refresh, Google idToken flow, and auto-link scenarios.

## Key Insights
- Existing test file is 489 lines — comprehensive but needs updates for all 3 changes
- Tests mock bcrypt globally — pattern stays same for composite tokens
- Need to update mockUser to include new provider columns
- refreshTokens tests need complete rewrite (different lookup pattern)
- oauthLogin tests need update for auto-link behavior (no more ConflictException on email match)

## Requirements
### Functional Tests Needed

**Composite Token (Phase 02):**
- [ ] `generateTokens()` returns composite format `uuid:hex`
- [ ] `refreshTokens()` splits token and does findOne by id
- [ ] `refreshTokens()` rejects malformed token (no `:`)
- [ ] `refreshTokens()` rejects unknown tokenId
- [ ] `refreshTokens()` rejects expired token
- [ ] `refreshTokens()` rejects wrong secret

**Google idToken (Phase 03):**
- [ ] `googleLogin()` validates idToken and creates new user
- [ ] `googleLogin()` finds existing Google user by provider ID
- [ ] `googleLogin()` passes sessionToken to onboarding linking

**Auto-Link (Phase 04):**
- [ ] `oauthLogin()` finds user by provider-specific column
- [ ] `oauthLogin()` auto-links when email matches existing user
- [ ] `oauthLogin()` creates new user when no match
- [ ] `oauthLogin()` does NOT throw ConflictException on email match
- [ ] `appleLogin()` auto-links when email matches

## Related Code Files
- **Modify:** `src/modules/auth/auth.service.spec.ts`

## Implementation Steps

1. Update `mockUser` to include new fields: `googleProviderId`, `appleProviderId`

2. Add `GoogleIdTokenStrategy` mock to test setup

3. Update `refreshTokens` describe block:
   - Mock `findOne` instead of `find` (single lookup)
   - Test composite token parsing
   - Test invalid format rejection

4. Add `googleLogin` describe block:
   - Mirror existing `appleLogin` test structure
   - Test idToken validation delegation
   - Test new user creation
   - Test existing user login

5. Update `oauthLogin` describe block:
   - Change "throw ConflictException" test → "auto-link" test
   - Test provider-specific column lookup
   - Test email-based auto-link flow

6. Update `appleLogin` describe block:
   - Change "throw ConflictException" test → "auto-link" test

7. Run `npm test` to verify all tests pass

## Todo List
- [x] Update mockUser with new columns
- [x] Add GoogleIdTokenStrategy mock
- [x] Rewrite refreshTokens tests for composite format
- [x] Add googleLogin tests
- [x] Update oauthLogin tests for auto-link
- [x] Update appleLogin tests for auto-link
- [x] Run tests and verify all pass

## Success Criteria
- All existing tests updated for new behavior
- New tests added for composite tokens, Google idToken, auto-link
- `npm test` passes with 0 failures
- No skipped or disabled tests

## Risk Assessment
- **Test coverage gaps:** May need additional edge case tests discovered during implementation
- **Mock complexity:** Unified oauthLogin with dynamic where clauses may need careful mock setup

## Next Steps
- After tests pass, code review and documentation update
