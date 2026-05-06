---
title: "Scenario Chat — Status Column + New Response Shape"
description: "Replace metadata.completed with ai_conversations.status enum (CHATTING/DONE), reshape POST/GET scenario chat responses to { scenario, messages } in snake_case, add LLM is_end soft-end signal."
status: done
priority: P1
effort: 4h
branch: dev
tags: [backend, scenario-chat, migration, api-change, dto]
created: 2026-04-25
completed: 2026-04-25
brainstorm: plans/reports/brainstormer-260425-scenario-chat-status-response.md
blockedBy: []
blocks: []
---

## Summary

Replace the JSONB `metadata.completed` flag with a real `status` enum column on `ai_conversations`. Reshape `POST /scenario/chat` plus the two scenario GET endpoints to return `{ scenario: { conversation_id, max_turns, turn, status }, messages: [{ id, role, content, created_at }] }` in snake_case. Soft-end (LLM `is_end:true`) and hard-end (turn ≥ maxTurns) both set status=DONE. Out-of-scope: prompt JSON update (user does separately).

## Phases

| Phase | File | Status | Effort |
|-------|------|--------|--------|
| 01 | [Migration: status column + index rebuild](phase-01-migration-status-column.md) | done | 30m |
| 02 | [Entity + LLM reply parser](phase-02-entity-and-llm-parser.md) | done | 30m |
| 03 | [Service refactor: status logic + new response shape](phase-03-service-status-and-shape.md) | done | 90m |
| 04 | [DTOs (snake_case) + controller wiring](phase-04-dto-and-controller.md) | done | 45m |
| 05 | [Tests + docs](phase-05-tests-and-docs.md) | done | 45m |

## Key Dependencies

- Phase 01 → 02 → 03 → 04 → 05 (strict sequential).
- Phase 03 depends on parser from 02 and entity from 02.
- Phase 04 depends on response builder in 03.
- Phase 05 last — verifies the full chain.

## Files Touched

**New:**
- `src/database/migrations/<ts>-add-status-to-ai-conversations.ts`

**Modified:**
- `src/database/entities/ai-conversation.entity.ts`
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/dto/scenario-chat.dto.ts`
- `src/modules/scenario/scenario-chat.controller.ts` (only if @Expose path doesn't auto-apply)
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `src/modules/scenario/dto/scenario-chat.dto.spec.ts`
- `src/modules/scenario/scenario-chat.controller.spec.ts`
- `docs/api-documentation.md`
- `docs/code-standards.md` (note snake_case exception)

## Out of Scope

- Updating `scenario-chat-prompt.json` to emit `{ reply, is_end }` (user handles separately).
- Migrating other endpoints to snake_case.
- API versioning.
