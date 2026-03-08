---
title: "Chat Correction Phase API"
description: "POST /ai/chat/correct endpoint to check grammar/vocabulary of user chat replies"
status: complete
priority: P2
effort: 1.5h
branch: feat/phase-correction
tags: [ai, grammar, chat, api]
created: 2026-03-09
---

# Chat Correction Phase

## Overview
New `POST /ai/chat/correct` endpoint that checks grammar/vocabulary of user's chat reply in context of previous AI message. Returns corrected version if errors found, null if correct. App calls this separately (parallel with chat response).

## Brainstorm Report
- [brainstorm-260309-0014-chat-correction-phase.md](../reports/brainstorm-260309-0014-chat-correction-phase.md)

## Phases

| # | Phase | Status | Effort | Files |
|---|-------|--------|--------|-------|
| 1 | [DTO & Prompt](./phase-01-dto-and-prompt.md) | complete | 20min | 3 create, 1 modify |
| 2 | [Service & Controller](./phase-02-service-and-controller.md) | complete | 30min | 2 modify |
| 3 | [Testing](./phase-03-testing.md) | complete | 30min | 1 create |

## Key Decisions
- **Model**: GPT-4.1 Nano (fast, cheap, sufficient for correction)
- **Auth**: `@OptionalAuth()` — works for auth + anonymous users
- **Response**: `{ correctedText: string | null }` — null means correct
- **Temperature**: 0.3 (deterministic correction)
- **No DB storage** — stateless correction, no conversation history needed

## Dependencies
- Existing `UnifiedLLMService`, `PromptLoaderService`
- `@OptionalAuth()` decorator
- `ThrottlerGuard` rate limiting
