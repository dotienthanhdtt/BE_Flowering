# Phase 4: AI/Translation Module

**Status:** Pending
**Priority:** High

## Overview

Remove `sessionToken` from translation service and DTO. Anonymous user ownership verification uses `conversationId` instead.

## Files to Modify

- `src/modules/ai/dto/translate-request.dto.ts`
- `src/modules/ai/services/translation.service.ts`
- `src/modules/ai/ai.controller.ts`

## Implementation Steps

### DTO
1. `translate-request.dto.ts`: Remove `sessionToken` field entirely. `conversationId` already exists and will be used for anonymous ownership.

### Service (`translation.service.ts`)
2. `translateWord()`: Remove `sessionToken` param. Change guard to `if (!userId && !conversationId)`. Use `conversationId` in metadata instead of `sessionToken`.
3. `translateSentence()`: Remove `sessionToken` param. Change guard to `if (!userId && !conversationId)`. Pass `conversationId` to ownership check.
4. `verifyMessageOwnership()`: Remove `sessionToken` param. For anonymous check, verify `message.conversation.id === conversationId && message.conversation.type === ANONYMOUS`.

### Controller (`ai.controller.ts`)
5. `translate()`: Remove `dto.sessionToken` from calls. Pass `dto.conversationId` instead.

## Key Change

**Before:** Anonymous ownership = compare `sessionToken` on conversation entity
**After:** Anonymous ownership = compare `conversationId` param with `message.conversation.id` (always true if message belongs to that conversation, so simplify to: if anonymous, verify conversation type is ANONYMOUS and conversation.id matches)

## Success Criteria

- No `sessionToken` in translate DTO or service
- Anonymous translation works via `conversationId`
- Authenticated translation unchanged
