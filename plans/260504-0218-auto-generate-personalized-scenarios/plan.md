---
title: "Auto-Generate Personalized Scenarios"
description: "Tier-gated AI intake → 5 personalized scenarios per fire; Plus unlimited, Premium 1/mo upsell."
status: complete
priority: P2
effort: 5d
branch: dev
tags: [personalization, ai, premium, scenarios]
created: 2026-05-04
completed: 2026-05-04
blockedBy: [260501-1146-centralize-scenarios]
blocks: []
context: ../reports/brainstorm-260504-auto-generate-personalized-scenarios.md
---

# Auto-Generate Personalized Scenarios — Implementation Plan

Trigger-based intake chat → LLM generates 5 personalized scenarios into `scenarios` table (`type='personal'`, `ownerUserId=user`). Premium Plus unlimited; Premium 1 free/month then paywall mid-flow; Free blocked. De-dup gate (24h + profile snapshot diff) caps LLM cost.

**Source brainstorm:** `../reports/brainstorm-260504-auto-generate-personalized-scenarios.md`

**Terminology note:** Brainstorm uses `source='personalized'`. Plan uses `type='personal'` (per centralize-scenarios schema landing first).

## Phases

| # | Phase | Status | Effort |
|---|---|---|---|
| 01 | Schema migrations (user, scenario flag, enums) | complete | 4h |
| 02 | Extract IntakeChatEngine from OnboardingService | complete | 6h |
| 03 | Personalization module skeleton (DTOs/controller/service/prompts) | complete | 6h |
| 04 | Quota service (Premium 1/mo UTC, Plus unlimited, 3/day ceiling) | complete | 3h |
| 05 | De-dup gate (24h + profile snapshot key+value diff) | complete | 3h |
| 06 | Trigger service + scenario-chat hook + advisory lock | complete | 4h |
| 07 | Paywall response shape + persistent conversation resume | complete | 3h |
| 08 | Soft-cap prune-on-insert (30 oldest unused) + list filter | complete | 3h |
| 09 | Tests: unit + integration + e2e mocked LLM | complete | 8h |
| 10 | Langfuse tagging + observability counters | complete | 2h |

**Total estimated effort:** ~42h (~5 working days).

## Dependencies

- **Hard blocker:** `260501-1146-centralize-scenarios` must merge first (introduces `type='personal'`, `ownerUserId`, drops `user_ai_scenarios`).
- Phase 01 blocks 03–08.
- Phase 02 blocks 03 (engine consumed by personalization service).
- Phase 04, 05 can run parallel (different services, both consumed by 06/07).
- Phase 06 depends on 03+04+05.
- Phase 07 depends on 04+06.
- Phase 09 last; Phase 10 parallel with 09.

## Key Decisions Locked

- v1 = backend only (no mobile in this plan).
- Quota window = UTC calendar month (skip TZ for v1).
- Soft-cap pruning = lazy on insert (no cron).
- Profile diff = top-level key set diff + value equality.
- Hard ceiling = 3 generations/day (safety net even for Plus).
- IntakeChatEngine refactor (Approach B) — pays back across onboarding + personalization.
- Trigger uses Postgres advisory lock on `userId` for race safety.
- Personalized scenarios persisted via `scenarios` row with `type='personal'` + `ownerUserId`.

## Out of Scope (v1)

- Mobile UX wiring (separate plan in `app_flowering`).
- TZ-aware quota windows.
- Cron-based pruning.
- Profile history (only latest snapshot retained).
- Admin UI for `triggersPersonalization` flag.
- Scenario editing post-generation.

## Risk Summary

| Risk | Mitigation Phase |
|---|---|
| LLM cost runaway | 05 (de-dup), 04 (3/day ceiling) |
| Double-trigger race | 06 (advisory lock) |
| Onboarding regression from refactor | 02 (existing tests must pass) |
| Premium user paywall abandonment | 07 (persist conversation, resume) |
| Diff too strict / too loose | 05 (telemetry-driven tune in 10) |
