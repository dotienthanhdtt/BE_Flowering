---
title: "Merge onboarding start + chat into single chat endpoint"
description: "Collapse POST /onboarding/start + /onboarding/chat into one POST /onboarding/chat. Branch by conversationId presence."
status: completed
priority: P2
effort: 4h
branch: dev
tags: [backend, onboarding, api, breaking-change, flutter]
created: 2026-04-14
completed: 2026-04-14
---

# Merge Onboarding Endpoints

## Goal

One endpoint (`POST /onboarding/chat`) handles both session creation and chat turns. No `/onboarding/start`. No backward compat.

## Contract (uniform response)

```
{ conversationId, reply, messageId, turnNumber, isLastTurn }
```

- **No conversationId** → `nativeLanguage` + `targetLanguage` required → create session, run first turn (greeting).
- **With conversationId** → validate session, optional `message`, run chat turn.
- `message` sent on creation call is silently ignored.

## Throttling

Custom `OnboardingThrottlerGuard`:
- 5/hr when `!conversationId` (creation guard vs IP abuse)
- 30/hr when present (normal chat)

## Phases

| # | File | Blockers | Status |
|---|------|----------|--------|
| 01 | [DTO + service `handleChat`](phase-01-dto-and-service.md) | — | completed |
| 02 | [Custom throttler guard](phase-02-throttler-guard.md) | — | completed |
| 03 | [Controller + Swagger + remove /start](phase-03-controller-and-swagger.md) | 01, 02 | completed |
| 04 | [Backend tests](phase-04-backend-tests.md) | 01, 02, 03 | completed |
| 05 | [Flutter client migration (separate repo)](phase-05-flutter-client.md) | 03 deployed | pending |
| 06 | [Docs + changelog](phase-06-docs-and-changelog.md) | 03 | completed |

## Dependency Graph

```
01 ─┐
    ├─► 03 ─► 04 ─► 06
02 ─┘         │
              └─► 05 (separate repo, after deploy)
```

## File Ownership (no overlap)

- Phase 01: `dto/onboarding-chat.dto.ts`, `dto/index.ts`, `dto/start-onboarding.dto.ts` (DELETE), `onboarding.service.ts`
- Phase 02: `onboarding-throttler.guard.ts` (NEW)
- Phase 03: `onboarding.controller.ts`, `onboarding.module.ts`
- Phase 04: `onboarding.controller.spec.ts`, `onboarding.service.spec.ts`
- Phase 05: Flutter repo `app_flowering/flowering/lib/features/chat/controllers/ai_chat_controller.dart`
- Phase 06: `docs/api-documentation.md`, `docs/project-changelog.md`

## Rollback

Each phase is a single commit. Revert commit reverses the phase. No data migration — DB schema unchanged (reuses `AiConversation`, `AiConversationMessage`).

## Success Criteria

- `POST /onboarding/chat` with only languages returns greeting + new `conversationId`
- Same endpoint with `conversationId` + `message` returns subsequent turn
- `/onboarding/start` returns 404
- `npm run build` passes
- All tests in `onboarding.*.spec.ts` pass
- Flutter app can complete onboarding flow end-to-end

## Test Matrix

| Scenario | Unit | Integration |
|----------|------|-------------|
| Create + greeting (no convId) | ✓ | ✓ |
| Chat turn (with convId) | ✓ | ✓ |
| Missing languages + no convId → 400 | ✓ | ✓ |
| Invalid convId → 404 | ✓ | ✓ |
| Expired session → 400 | ✓ | — |
| Max turns reached → 400 | ✓ | — |
| Throttle 5/hr on create branch | — | manual |
| Throttle 30/hr on chat branch | — | manual |

## Unresolved Questions

- Keep `StartOnboardingDto` import removed from `dto/index.ts` barrel — any other module importing it? (scout grep needed during phase 01)
- Flutter deploy cadence vs backend deploy — do we need a transitional period where backend tolerates `/start`? **Decision taken: no compat, cut over atomically.** Confirm release coordination with mobile team before merging phase 03.
