---
title: "Persist Chat Correction via Client-Orchestrated PUT Endpoint"
date: 2026-05-19
type: brainstorm
related-plan: 260519-2340-chat-correction-persist-via-put-endpoint
---

# Brainstorm — Persist Chat Correction via PUT Endpoint (Approach C)

## Problem
`/ai/chat/correct` returns `correctedText` but cannot persist without `messageId`. User message gets its UUID only after `/scenario/chat` commits. Current Flutter flow fires both in parallel — correction text shown but never written to `ai_conversation_messages.corrected_content` → lost on conversation reload.

## Goal
After every user turn: corrected_content persisted on the corresponding user message row, visible on transcript reload.

## Constraints
- Keep `/ai/chat/correct` and `/scenario/chat` independent (no folding)
- Run both in parallel (no added latency)
- No new server-side cache infra (no Redis, no in-memory state)
- Multi-instance safe
- Backward compat: existing `/ai/chat/correct` callers untouched

## Approaches considered

| | Inline (A) | Server-correlated tempId (B) | Client-orchestrated PUT (C) |
|---|---|---|---|
| Backend complexity | +30 LOC | +200 LOC, schema migration, cache | **+50 LOC, no migration** |
| Round trips / turn | 1 | 2 | **3** (+~100ms) |
| Multi-instance safe | yes | needs Redis | **yes** |
| Race conditions | 0 | ~6 | **0** |
| Separation of concerns | weak | strong | **strong** |
| Existing API unchanged | no | no | **yes** |

C chosen: cleanest backend, multi-instance safe by default, separation preserved. Cost = 1 extra ~100ms RTT/turn.

## Solution (Approach C)

### Flow
1. Flutter renders user bubble locally (optimistic, no server help needed)
2. Parallel: `POST /scenario/chat` + `POST /ai/chat/correct` (no messageId)
3. On both resolve: Flutter fires `PUT /ai/messages/:realId/corrected-content {correctedText}`
4. Server UPDATE → row reflects corrected_content on next reload

### Backend
- New: `PUT /ai/messages/:messageId/corrected-content`
  - Auth: JWT required (no @OptionalAuth)
  - Body: `{ correctedText: string | null }` (max 4000)
  - Owner check: load message → conversation → assert `conversation.userId === req.user.id`
  - Throttle: 10 req/min/user
  - Returns 204
- No schema change. `corrected_content` column exists since 1782600000000.
- No change to `/ai/chat/correct` or `/scenario/chat`.

### Flutter
- `ai_chat_controller.dart`: await `Future.wait([chat, correct])` (already there) → on both resolve, swap tempId→realId from chat response, fire PUT.
- Fire-and-forget PUT with Hive-backed retry queue on network failure.
- Render `corrected_content` from transcript on conversation reload (already in response DTO; just display when present).

## Edge cases
| Scenario | Behavior |
|----------|----------|
| Client crash after responses, before PUT | Hive queue retries on next app open |
| Concurrent PUTs same id | Idempotent UPDATE, last-write-wins |
| User dismisses correction | Skip PUT (or PUT `null` to clear) |
| Correct returns null (no errors) | Still PUT `null` so DB reflects "checked, clean" |
| Correct LLM fails | Skip PUT; corrected_content stays null |
| 403/404 on PUT | Drop from queue, log warning |

## Out of scope
- Onboarding-chat (same pattern can apply later)
- Editing correction text via UI (UI work, free with this API)
- Bulk historical re-correction
- Deprecating `messageId` field on `/ai/chat/correct` (kept for backward compat)

## Success criteria
- PUT endpoint persists corrected_content with proper auth/owner checks
- Flutter fires PUT after both chat + correct resolve
- Conversation reload shows persisted corrections
- Network failure on PUT → retry from Hive queue
- No regression on existing chat or correct endpoints
