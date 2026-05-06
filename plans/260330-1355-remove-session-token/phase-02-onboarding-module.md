# Phase 2: Onboarding Module

**Status:** Pending
**Priority:** High

## Overview

Replace `sessionToken` with `conversationId` in onboarding DTOs and service. The conversation's UUID PK becomes the session identifier.

## Files to Modify

- `src/modules/onboarding/dto/onboarding-chat.dto.ts` — `sessionToken` -> `conversationId`
- `src/modules/onboarding/dto/onboarding-complete.dto.ts` — `sessionToken` -> `conversationId`
- `src/modules/onboarding/onboarding.service.ts` — Remove sessionToken generation, use `conversation.id` for lookup
- `src/modules/onboarding/onboarding.controller.ts` — Update Swagger description

## Implementation Steps

### DTOs
1. `onboarding-chat.dto.ts`: Rename `sessionToken` to `conversationId`, update description
2. `onboarding-complete.dto.ts`: Same rename

### Service (`onboarding.service.ts`)
3. `startSession()`:
   - Remove `const sessionToken = randomUUID()` and `randomUUID` import
   - Remove `sessionToken` from `conversationRepo.create()`
   - Return `{ conversationId: saved.id }` only
4. `chat()`: Change `dto.sessionToken` to `dto.conversationId`
5. `complete()`: Change `dto.sessionToken` to `dto.conversationId`
6. `findValidSession(sessionToken)` -> `findValidSession(conversationId)`:
   - Change lookup from `{ sessionToken, type: ANONYMOUS }` to `{ id: conversationId, type: ANONYMOUS }`

### Controller
7. Update Swagger `@ApiResponse` description from `session_token` to `conversation_id`

## Success Criteria

- `POST /onboarding/start` returns `{ conversationId }` (no sessionToken)
- Chat/complete accept `{ conversationId }` in body
- Lookup uses conversation PK instead of sessionToken
