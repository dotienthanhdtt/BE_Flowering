---
title: "Make /ai/translate optionally public for onboarding users"
description: "Allow anonymous onboarding users to translate words/sentences without JWT by accepting sessionToken"
status: pending
priority: P1
effort: 2h
branch: feat/translate-word-sentence
tags: [ai, translate, onboarding, auth]
created: 2026-03-08
---

# Make /ai/translate Optionally Public

## Goal
Onboarding users (no JWT) can call `POST /ai/translate` using their `sessionToken`. Authenticated users continue using JWT as before.

## Key Findings
- `@Public()` skips JWT guard entirely; `request.user` becomes `undefined`
- Onboarding sessions stored in DB: `AiConversation.sessionToken` + `type=ANONYMOUS`
- `AiConversationMessage` links to conversation via `conversationId`; conversation has `sessionToken`
- Word translate currently upserts to `Vocabulary` (requires `userId`) -- anonymous must skip DB save
- Sentence translate verifies `message.conversation.userId` -- anonymous must verify via `sessionToken`

## Design
- Add `@Public()` to `/ai/translate` endpoint
- Attempt JWT extraction manually (optional auth) via passport trick or manual token check
- If `request.user` exists: authenticated path (existing behavior)
- If no `request.user`: require `sessionToken` in DTO, use anonymous path
- Anonymous word translate: LLM call only, return result without `vocabularyId`
- Anonymous sentence translate: verify message ownership via `sessionToken` on conversation

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Update DTO and Controller | pending | [phase-01](./phase-01-update-dto-and-controller.md) |
| 2 | Update Translation Service | pending | [phase-02](./phase-02-update-translation-service.md) |

## Dependencies
- `AiConversation` entity already has `sessionToken` field
- `AiModule` already imports `AiConversationMessage` repository
- Need `AiConversation` repository in `TranslationService` (or inject via `AiModule`)

## Risk
- Must not break existing authenticated translate flow
- Anonymous users get no vocabulary persistence (by design)
- Rate limiting still applies via ThrottlerGuard on controller
