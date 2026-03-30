# Phase 3: Auth Module

**Status:** Pending
**Priority:** High

## Overview

Replace `sessionToken` with `conversationId` in auth DTOs, service, and controller for onboarding session linking.

## Files to Modify

- `src/modules/auth/dto/register.dto.ts`
- `src/modules/auth/dto/login.dto.ts`
- `src/modules/auth/dto/google-auth.dto.ts`
- `src/modules/auth/dto/apple-auth.dto.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/auth.controller.ts`

## Implementation Steps

### DTOs (4 files)
1. In each DTO, rename `sessionToken` -> `conversationId`, update description to "Onboarding conversation ID to link"

### Service (`auth.service.ts`)
2. `register()`: `dto.sessionToken` -> `dto.conversationId`
3. `login()`: Same
4. `googleLogin()`: Param `sessionToken` -> `conversationId`
5. `appleLogin()`: Same
6. `oauthLogin()`: Param `sessionToken` -> `conversationId`
7. `linkOnboardingSession(userId, sessionToken)` -> `linkOnboardingSession(userId, conversationId)`:
   - Change find criteria from `{ sessionToken, type: ANONYMOUS }` to `{ id: conversationId, type: ANONYMOUS }`
   - Update to set `{ userId, type: AUTHENTICATED }` (remove `sessionToken: null`)

### Controller (`auth.controller.ts`)
8. `googleAuth()`: `dto.sessionToken` -> `dto.conversationId`
9. `appleAuth()`: Same

## Success Criteria

- All auth endpoints accept `conversationId` instead of `sessionToken`
- Linking finds conversation by PK, not by sessionToken
