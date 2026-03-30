# Phase 1: Database Migration

**Status:** Pending
**Priority:** High (blocking)

## Overview

Drop `session_token` column and its unique index from `ai_conversations` table. Remove `sessionToken` property from entity.

## Files to Modify

- `src/database/entities/ai-conversation.entity.ts` — Remove `sessionToken` column definition
- New migration file — Drop column + index

## Implementation Steps

1. Remove `sessionToken` column from `AiConversation` entity (lines 37-38)
2. Create migration:
   ```sql
   -- Up
   DROP INDEX IF EXISTS "IDX_ai_conversations_session_token";
   ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "session_token";

   -- Down
   ALTER TABLE "ai_conversations" ADD COLUMN "session_token" VARCHAR(255);
   CREATE UNIQUE INDEX "IDX_ai_conversations_session_token"
     ON "ai_conversations" ("session_token")
     WHERE "session_token" IS NOT NULL;
   ```

## Success Criteria

- Entity no longer has `sessionToken` property
- Migration runs cleanly up and down
- Build compiles without errors
