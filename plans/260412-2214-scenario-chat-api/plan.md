---
title: "Scenario Chat API (/scenario/chat)"
description: "Single-endpoint AI roleplay chat parameterized by scenarioId, with 12-turn cap and resumable conversations per (userId, scenarioId)."
status: complete
priority: P1
effort: 6h
branch: dev
tags: [ai, scenario, chat, roleplay, nestjs]
created: 2026-04-12
completed: 2026-04-12
brainstorm: plans/reports/brainstorm-260412-2214-scenario-chat-api.md
blockedBy: []
blocks: []
---

# Scenario Chat API

## Summary

Add `POST /scenario/chat` — authenticated users engage in immersive AI roleplay tied to a specific `Scenario`. Single endpoint handles: new opening, new with user opener, and resume. Reuses `AiConversation` + `AiConversationMessage` + `UnifiedLLMService` + `PromptLoaderService`. JSON prompt file injects scenario + user language context. 12-turn cap with natural wrap-up.

## Architecture Decisions

- **Single endpoint** (not /start + /chat) — KISS, one route handles 3 states.
- **Reuse `AiConversation`** with added `scenarioId` column (indexable find-or-create). Other metadata (`maxTurns`, `completed`) stored on existing `metadata` jsonb column — no over-engineering.
- **New service `ScenarioChatService`** in `src/modules/scenario/` (kept separate from `LearningAgentService` — different prompt, different context).
- **AI improvises character/setting** from scenario `title` + `description` (no new roleplay schema fields — YAGNI).
- **Rate limit** via existing `ThrottlerGuard` (ai-short 20/min, ai-medium 100/hr).
- **Prompt loaded as plaintext JSON string** — `PromptLoaderService` already supports this.

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Database: add scenarioId to AiConversation + migration | complete | S | phase-01-database-migration.md |
| 2 | Prompt JSON + ScenarioChatService | complete | M | phase-02-prompt-and-service.md |
| 3 | Controller + DTO + Module wiring | complete | S | phase-03-controller-module.md |
| 4 | Tests (unit + integration) | complete | M | phase-04-tests.md |
| 5 | Docs update (API docs + changelog) | complete | S | phase-05-docs.md |

## Key Dependencies

- **Existing entities**: `AiConversation`, `AiConversationMessage`, `Scenario`, `User`, `UserLanguage`, `Language`, `Subscription`
- **Existing services**: `UnifiedLLMService`, `PromptLoaderService`, `LanguageService`, `LessonService` (access query pattern)
- **External**: None

## Open Questions (Pre-Implementation)

All resolved during brainstorm scout — see phase files for details.

## Success Criteria

- POST `/scenario/chat` returns 200 with non-empty `reply` in < 3s p95
- Opening turn in-character across 10 test scenarios (manual QA)
- `completed: true` correctly set at turn 12
- Resume works: same `conversationId` appends correctly across calls
- Premium scenarios blocked for non-entitled users with proper error
- All unit + integration tests pass
- `npm run build` + `npm run lint` clean
