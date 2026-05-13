---
title: "Scenario Complete API with Evaluation"
description: "POST /scenario/complete endpoint: marks conversation DONE, runs LLM evaluation (overall/fluency/accuracy/vocab scores), persists to dedicated scenario_evaluations table with UNIQUE(conversation_id) for idempotency, moves personalizationTrigger from chat path to /complete as single trigger point."
status: completed
priority: P2
effort: ~1.5d
branch: "dev"
tags: [scenario, evaluation, llm, personalization]
blockedBy: []
blocks: []
related: [260412-2214-scenario-chat-api, 260504-0218-auto-generate-personalized-scenarios]
context: ../reports/brainstorm-260513-2022-scenario-complete-evaluation.md
created: "2026-05-13T13:30:14.046Z"
createdBy: "ck:plan"
source: skill
---

# Scenario Complete API with Evaluation

## Overview

New `POST /scenario/complete` endpoint that finalizes a scenario conversation: flips status to DONE, runs sync LLM evaluation against the transcript + injected vocab, persists evaluation to a dedicated table, and triggers personalization. Replaces the implicit DONE-flip side effects currently buried in `ScenarioChatService.chat()`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Migration & Entity](./phase-01-migration-entity.md) | Completed |
| 2 | [DTOs & Prompt](./phase-02-dtos-prompt.md) | Completed |
| 3 | [Evaluator Service](./phase-03-evaluator-service.md) | Completed |
| 4 | [Complete Service](./phase-04-complete-service.md) | Completed |
| 5 | [Controller & Chat Refactor](./phase-05-controller-chat-refactor.md) | Completed |
| 6 | [Tests](./phase-06-tests.md) | Completed |
| 7 | [Docs](./phase-07-docs.md) | Skipped

## Dependencies

- Phase 2 depends on Phase 1 (entity must exist for DTOs to reference)
- Phase 3 depends on Phase 2 (uses prompt + DTOs)
- Phase 4 depends on Phase 3 (orchestrates evaluator)
- Phase 5 depends on Phase 4 (controller calls service)
- Phase 6 depends on Phases 1-5
- Phase 7 depends on Phase 5 (API surface finalized)

## Key Decisions (from brainstorm)

- Dedicated `scenario_evaluations` table (NOT JSONB column) — analytics + DB-level idempotency
- Sync LLM call (YAGNI on async queues)
- `personalizationTrigger.maybeTrigger()` moves from chat → `/complete` only (single entry point)
- LLM failure → 200 + `evaluation: null` + error flag; status stays DONE; retryable
- Score dimensions: overall, fluency, accuracy, vocab (all 0-100)

## Context

- Brainstorm report: `../reports/brainstorm-260513-2022-scenario-complete-evaluation.md`
- Source service: `src/modules/scenario/services/scenario-chat.service.ts`
- Trigger service: `src/modules/personalization/services/personalization-trigger.service.ts`

## Red Team Review

### Session — 2026-05-13
**Findings:** 25 raw → 15 accepted, 10 rejected
**Severity breakdown:** 3 Critical, 8 High, 4 Medium
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Prompt placeholder syntax `{{var}}` not `{var}` (PromptLoaderService:65) | Critical | Accept | Phase 2, 3 |
| 2 | Advisory lock MANDATORY (not optional) — concurrent /complete LLM cost amplification | Critical | Accept | Phase 4 |
| 3 | Keep dual-fire trigger during transition — removing from chat regresses v2.18.x clients | Critical | Accept | Phase 5 |
| 4 | Explicit IDOR test (attacker userId + victim conversationId) | High | Accept | Phase 6 |
| 5 | Chat-path DONE must also set `completedAt` (else column ~always NULL) | High | Accept | Phase 1, 5 |
| 6 | Vocab-usage fallback: re-match transcript when `VocabularyInjectionEvent` empty | High | Accept | Phase 3 |
| 7 | Tombstone row + retry cap (3) on EvaluatorError to bound LLM spend | High | Accept | Phase 1, 4 |
| 8 | Migration down: RENAME to archive table instead of DROP | High | Accept | Phase 1 |
| 9 | Register entity in `typeorm-data-source.ts` (not just `database.module.ts`) | High | Accept | Phase 1 |
| 10 | Use `resolveExisting` helper + non-null assert `scenario.id` | High | Accept | Phase 4 |
| 11 | DEFER helper extraction — duplicate 3 small helpers, refactor in follow-up PR | High | Accept | Phase 4 |
| 12 | Response field whitelist (exclude model_used, prompt_version, internal IDs) | Medium | Accept | Phase 2, 6 |
| 13 | `evaluation_error` is closed enum, never raw `EvaluatorError.message` | Medium | Accept | Phase 2, 3, 6 |
| 14 | 15s LLM timeout → `evaluation_error: 'timeout'` | Medium | Accept | Phase 3, 6 |
| 15 | Dedicated `scenario-complete` throttle bucket (not shared with chat's `ai-short`) | Medium | Accept | Phase 5 |

**Rejected (10):** Prompt-injection sanitization (heavy mitigation, out of scope — flagged as known); score-dimension reduction to 1; vocab_usage column drop; strengths/improvements/summary collapse; reconsider JSONB-vs-table; prompt_version removal; 2-service collapse; docs file trim; messages[] removal from response; scenarioId-from-request removal. All conflict with user-approved brainstorm decisions OR are out-of-scope concerns (Langfuse PII, premium-gate no-op).

### Schema Delta (from accepted findings)

`scenario_evaluations` adds two columns beyond original Phase 1 spec:
- `error_count smallint NOT NULL DEFAULT 0`
- `last_error_code varchar(32) NULL`

Allows tombstone-row pattern: row exists with NULL scores + error_count tracks retries.

### Whole-Plan Consistency Sweep

- ✅ Phase 1 schema includes `error_count`, `last_error_code` per finding #7
- ✅ Phase 1 step 8 covers both `database.module.ts` and `typeorm-data-source.ts`
- ✅ Phase 1 down-migration uses RENAME not DROP
- ✅ Cross-phase note: chat-path also writes `completedAt` (Phase 1 → Phase 5 step 4b)
- ✅ Phase 2 placeholder spec uses `{{var}}` syntax — propagated to Phase 3 step 3
- ✅ Phase 2 `evaluation_error` enum — used by Phase 3 step 5 and Phase 4 architecture
- ✅ Phase 2 field whitelist — referenced by Phase 4 mapper and Phase 6 test
- ✅ Phase 3 vocab fallback + 15s timeout + opaque error code
- ✅ Phase 4 advisory lock + tombstone + resolveExisting + helper duplication (no extraction)
- ✅ Phase 4 "Helper Extraction — DEFERRED" section replaces previous "if extracted" pseudo-spec
- ✅ Phase 5 dual-fire trigger (no removal) + completedAt write + dedicated throttle bucket
- ✅ Phase 6 tests cover: IDOR, timeout, retry-cap, response whitelist, advisory-lock, dual-fire
- ✅ No stale references to "remove personalization trigger from chat" — replaced with "keep dual-fire during transition"
- ✅ No stale references to `ScenarioConversationHelpersService`

**No unresolved contradictions.** Plan ready for `/ck:cook`.
