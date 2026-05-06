---
title: Drop ai_conversations.metadata JSONB column
description: Eradicate metadata JSONB. Promote maxTurns + native_language to columns, derive targetLanguage from languageId join, derive completed from status enum, re-key partial unique index.
status: completed
priority: P1
effort: 4h
branch: dev
tags: [backend, refactor, migration, scenario-chat, onboarding, schema]
created: 2026-05-04
brainstorm: brainstorm-summary.md
blockedBy: []
blocks: []
---

# Drop `ai_conversations.metadata` JSONB Column

**Authoritative spec:** `brainstorm-summary.md` (this directory).

## Why

`metadata` is dual-encoded with `status`, untyped, and source of the DONE → CHATTING resurrection bug. Five callsites cast `metadata as Record<string,...>`. Two real fields (`maxTurns`, `nativeLanguage`) deserve real columns; one (`targetLanguage`) is redundant with `languageId`; one (`completed`) duplicates `status`.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 01 | Migration: add columns, backfill, swap index, drop metadata | completed |
| 02 | Entity update | completed |
| 03 | Scenario-chat service refactor | completed |
| 04 | Onboarding + intake-engine + auth refactor | completed |
| 05 | Test fixtures + smoke verification | completed |

## Key Dependencies

- Phase 01 schema changes must land in the same deploy as Phase 02-04 code.
- Phase 02 entity must drop `metadata` and add new fields before Phase 03/04 reference them.
- Phase 03 and Phase 04 are independent (different services) and can be done in parallel after Phase 02.
- Phase 05 runs last.

## Success Criteria

- `metadata` column removed from `ai_conversations`.
- No `conversation.metadata` references remain in `src/` (excluding migration history).
- `npm run build` clean, `npm test` passes.
- Manual smoke: scenario DONE → re-enter creates fresh row (status CHATTING, new id). Onboarding → auth bootstraps `User.nativeLanguage`.
