# Remove session_token, Use conversation_id Only

**Status:** Ready
**Priority:** Medium
**Branch:** dev

## Summary

Remove `sessionToken` from the entire codebase. Anonymous onboarding sessions and translation ownership will use `conversationId` (the `ai_conversations.id` UUID PK) instead.

**Why:** `sessionToken` is a redundant UUID — the conversation already has a UUID primary key (`id`). Using two UUIDs for the same entity adds unnecessary complexity.

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [Database migration](phase-01-database-migration.md) | Pending | 2 |
| 2 | [Onboarding module](phase-02-onboarding-module.md) | Pending | 4 |
| 3 | [Auth module](phase-03-auth-module.md) | Pending | 7 |
| 4 | [AI/Translation module](phase-04-ai-translation-module.md) | Pending | 4 |
| 5 | [Tests](phase-05-tests.md) | Pending | 5 |
| 6 | [Docs](phase-06-docs.md) | Pending | ~8 |

## Dependencies

- Phase 1 (migration) must run first
- Phases 2-4 can be done in parallel
- Phase 5 after 2-4
- Phase 6 after all

## Key Decision

- `POST /onboarding/start` response: `{ conversationId }` (no more `sessionToken`)
- `POST /onboarding/chat` and `/complete` body: `{ conversationId }` instead of `{ sessionToken }`
- Auth DTOs: `sessionToken` -> `conversationId` (for linking onboarding conversation)
- Translation: Remove `sessionToken` param; use `conversationId` for anonymous ownership check
- `linkOnboardingSession`: Find by `id` instead of `sessionToken`
