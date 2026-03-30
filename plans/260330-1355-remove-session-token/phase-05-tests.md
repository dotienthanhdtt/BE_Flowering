# Phase 5: Tests

**Status:** Pending
**Priority:** Medium

## Overview

Update all test files to use `conversationId` instead of `sessionToken`.

## Files to Modify

- `src/modules/onboarding/onboarding.service.spec.ts`
- `src/modules/onboarding/onboarding.controller.spec.ts`
- `src/modules/auth/auth.service.spec.ts`
- `src/modules/auth/auth.controller.spec.ts`
- `src/modules/ai/services/translation.service.spec.ts`

## Implementation Steps

1. **Onboarding service spec**: Replace all `sessionToken` refs with `conversationId`. Update mock data. Update `startSession` assertions (no sessionToken in response).
2. **Onboarding controller spec**: Same renames.
3. **Auth service spec**: Rename `sessionToken` to `conversationId` in test data. Update `linkOnboardingSession` expectations to find by `id` instead of `sessionToken`.
4. **Auth controller spec**: Rename DTO fields and assertion values.
5. **Translation service spec**: Remove `sessionToken` from test cases. Use `conversationId` for anonymous user tests. Update ownership verification tests.

## Success Criteria

- `npm test` passes with 0 failures
- All sessionToken references removed from test files
