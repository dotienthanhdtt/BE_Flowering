---
title: "Persist Chat Correction via PUT Endpoint"
description: "Add PUT /ai/messages/:id/corrected-content so Flutter can persist grammar correction after parallel chat + correct calls resolve. Approach C from brainstorm."
status: completed
priority: P2
branch: "dev"
tags: [ai, chat, correction, api, flutter]
blockedBy: []
blocks: []
created: "2026-05-19T16:41:14.817Z"
createdBy: "ck:plan"
source: skill
---

# Persist Chat Correction via PUT Endpoint

## Overview

`/ai/chat/correct` returns `correctedText` but cannot persist without a `messageId` (user msg row only gets its UUID after `/scenario/chat` commits). Today Flutter fires both endpoints in parallel and **displays** correction in the user bubble — but never writes `corrected_content` to DB → lost on conversation reload.

This plan adds a small write-only endpoint: `PUT /ai/messages/:messageId/corrected-content`. Client orchestrates: after both parallel responses resolve, fires PUT with the real messageId from chat response + correctedText from correct response. No schema change, no server-side cache, multi-instance safe.

**Brainstorm**: [reports/brainstorm-260519-2340-chat-correction-persist-via-put-endpoint.md](../reports/brainstorm-260519-2340-chat-correction-persist-via-put-endpoint.md)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend PUT endpoint + tests](./phase-01-backend-put-endpoint-tests.md) | Completed |
| 2 | [Flutter wire PUT after parallel responses](./phase-02-flutter-wire-put-after-parallel-responses.md) | Completed |
| 3 | [Flutter retry queue + reload rendering](./phase-03-flutter-retry-queue-reload-rendering.md) | Completed |

## Key Decisions

- **No schema change** — `ai_conversation_messages.corrected_content` already exists (migration 1782600000000)
- **Client orchestration** — server stays stateless between chat + correct calls
- **Backward compat** — `/ai/chat/correct` `messageId` field kept (legacy callers still work)
- **Fire-and-forget on Flutter** with Hive-backed retry on network failure
- **Idempotent PUT** — last-write-wins on `corrected_content`

## Dependencies

- Backend: existing `AiConversationMessage` entity, `AiConversation` for ownership check, JWT guard, ThrottlerGuard
- Flutter: existing `ai_chat_controller.dart` parallel call pattern, Hive for offline queue
