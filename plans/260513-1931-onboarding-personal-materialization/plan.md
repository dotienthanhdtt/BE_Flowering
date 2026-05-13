---
title: "Onboarding → Personal Scenarios Materialization"
description: "Materialize anonymous-onboarding scenarios into real PERSONAL Scenario rows at auth-link time. Simplify schema (drop difficulty/icon/accentColor) so JSON output maps 1:1 to scenarios table. Includes wider-scope cleanup of all difficulty consumers (lesson, redeem, admin-content, AI prompts, seed)."
status: done
priority: P2
effort: ~2.5d
branch: "dev"
tags: [onboarding, scenarios, personalization, schema]
blockedBy: []
blocks: []
related: [260504-0218-auto-generate-personalized-scenarios, 260504-onboarding-after-login-detection]
context: ../reports/brainstorm-260513-1924-onboarding-personal-materialization.md
created: "2026-05-13T12:32:28.268Z"
createdBy: "ck:plan"
source: skill
---

# Onboarding → Personal Scenarios Materialization

## Overview

`GET /scenarios/personal` returns empty for users who completed onboarding. Onboarding generates 5 scenarios as JSON on `ai_conversations` row but never inserts them into the `scenarios` table. PERSONAL rows are only created via the separate authenticated `/personalization` intake flow.

This plan adds materialization-on-link in `auth.service.linkOnboardingSession`, simplifies the scenario shape (drops `difficulty` column, `icon`, `accentColor` from onboarding DTO) so the onboarding JSON output maps 1:1 to the `scenarios` table, and consolidates personal-scenario construction in a shared helper used by both onboarding materialization and the existing personalization service.

**Source brainstorm:** `../reports/brainstorm-260513-1924-onboarding-personal-materialization.md`
**Red team review:** see `## Red Team Review` section below — 15 findings applied.

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [Schema Migration](./phase-01-schema-migration.md) | Done | 2h |
| 2 | [DTO + Entity + Prompt + Consumer Cleanup](./phase-02-dto-entity-prompt-cleanup.md) | Done | 4h |
| 3 | [Shared Helper (DRY) + Sanitization](./phase-03-shared-helper-dry.md) | Done | 1.5h |
| 4 | [Materialization + Auth Wiring](./phase-04-materialization-and-auth-wiring.md) | Done | 4h |
| 5 | [Tests + Docs](./phase-05-tests-and-docs.md) | Done | 4h |

**Total estimate:** ~15.5h (~2.5 working days). Inflated from 10h due to wider blast radius surfaced by red-team review.

## Dependencies

Sequential:
- P1 (migration) blocks P2.
- P2 (entity/DTO/consumer cleanup) blocks P3.
- P3 (helper) blocks P4.
- P4 (materialization) blocks P5.

## Key Decisions (post red-team)

- **Drop `difficulty` column** from `scenarios` table; **drop `icon`/`accentColor`** from `OnboardingScenarioDto`. **Mobile UX regression accepted** — Flutter cards will render with default visuals until mobile catches up. No deprecated-optional fields kept.
- **Wider Phase 2 scope:** consumers in `lesson`, `redeem`, `admin-content`, both AI prompts, and seed file must be cleaned up — not just scenario module.
- **Idempotency via `INSERT ... ON CONFLICT (id) DO NOTHING`** (not upsert). PK collision → skip; no cross-user `ownerId` overwrite possible. Onboarding-generated `id` reused as `Scenario.id`.
- **New `ScenarioMaterializationModule`** (thin module exporting only the materialization service + `TypeOrmModule.forFeature([Scenario])`). Imported by `AuthModule`. Avoids pulling `ScenariosController`/Throttler config into auth.
- **Structured log events** for materialization outcomes (success / skip-empty-json / skip-bad-shape / skip-no-languageId / skip-bad-title / fail-db). Compensates for Sentry removal — events grep-countable in Railway logs.
- **Title sanitization in helper:** trim to 255 chars, strip control chars and basic HTML. Defense against malicious LLM-steering during anonymous onboarding.
- **Two-step deploy on dev (Railway):** ship code first (stops reading `difficulty`), verify, then ship migration that drops the column. Makes both code and DB rollback-safe.
- **Spec sweep into Phase 2** (not Phase 5). Specs import `ScenarioDifficulty` and would fail compile mid-plan otherwise.
- **Helper does NOT hard-code `orderIndex`/`accessTier`** — opt-in only (omit if not passed). Preserves existing personalization behavior (DB defaults).
- **Migration timestamp**: hand-picked > highest existing (`1780000000000`), not `Date.now()`.

## Out of Scope

- Direct sign-in users (skip onboarding entirely) — separate concern.
- Backfill for users who already signed in pre-feature.
- Fallback regeneration for users with `scenarios=null` (pre-cache) conversations — emit warn log only; separate follow-up plan.
- Flutter app code changes — backend ships breaking response shape; mobile catches up in a separate PR.

## Mandatory Pre-Cook Gates

1. **Grep `\.difficulty\b` across `src/` and confirm** every consumer is enumerated in Phase 2 file list. Findings 1 + 3 + 6 of red-team identified that the initial scope missed lesson, redeem, admin-content, and the personalization prompt. Pre-cook MUST re-run this grep against the actual codebase.
2. **Verify no module cycle** when wiring `AuthModule → ScenarioMaterializationModule` (smaller surface than full ScenariosModule, so safer; still verify).
3. **Verify `Scenario` entity is registered in `src/database/database.module.ts` global entities array** (per CLAUDE.md Railway deployment rule — missing global registration is a known runtime-500 source).
4. **Run `psql \dT+ scenario_difficulty`** on dev DB to confirm no view/function outside migrations uses the Postgres enum type.

## Red Team Review

### Session — 2026-05-13
**Findings:** 15 (15 accepted, 0 rejected)
**Severity breakdown:** 4 Critical, 5 High, 6 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | `difficulty` consumers in lesson/redeem/admin/prompts/seed not in Phase 2 scope | Critical | Accept | Phase 2 |
| 2 | Flutter requires `icon`/`accentColor` — UX regression on ship | Critical | Accept (accepted regression) | Plan decisions + Phase 2 risk |
| 3 | Upsert by PK has no `ownerId` guard — cross-user overwrite | Critical | Accept | Phase 4 (switch to ON CONFLICT DO NOTHING) |
| 4 | Code + migration ship together — rollback hole on Railway | Critical | Accept | Plan decisions (two-step deploy) |
| 5 | Migration leaves orphaned index + enum type; `down()` wrong type | High | Accept | Phase 1 |
| 6 | Both AI prompts still say "Align difficulty with suggestedProficiency" | High | Accept | Phase 2 |
| 7 | Observability gap (Sentry removed) — no structured events | High | Accept | Phase 4 + Phase 5 |
| 8 | Silent skip on null/short JSON — pre-cache users get nothing | High | Accept | Phase 4 (structured warn) |
| 9 | XSS / oversize title surface — varchar(255) DB rejection | High | Accept | Phase 3 (sanitization) |
| 10 | Spec sweep timing — specs use `ScenarioDifficulty` import | Medium | Accept | Phase 2 (moved from Phase 5) |
| 11 | ScenariosModule drag — controller + throttler conflict | Medium | Accept | Phase 4 (thin module) |
| 12 | Migration timestamp `Date.now()` collides with hand-picked scheme | Medium | Accept | Phase 1 |
| 13 | Helper hard-coding `orderIndex`/`accessTier` reorders personalization | Medium | Accept | Phase 3 |
| 14 | Pre-cache conversations silent skip | Medium | Accept (warn-only) | Phase 4 |
| 15 | E2E Firebase mocking strategy unspecified | Medium | Accept | Phase 5 (Nest DI direct call) |

### Whole-Plan Consistency Sweep — 2026-05-13
- Decision delta: drop `accessTier`/`orderIndex` defaults from helper → Phase 3 helper signature changed; Phase 4 uses arrayIndex via input.orderIndex explicitly.
- Decision delta: upsert → ON CONFLICT DO NOTHING (no update path) → Phase 4 service body rewritten; Phase 5 idempotency test updated.
- Decision delta: thin `ScenarioMaterializationModule` → Phase 4 module-wiring rewritten; Phase 5 docs updated.
- Decision delta: wider Phase 2 scope → Phase 2 file list expanded; success criteria updated; effort bumped 2h→4h.
- Decision delta: mobile regression accepted → Phase 2 risk section updated; plan "Out of Scope" updated.
- Decision delta: structured log events → Phase 4 service includes named events; Phase 5 tests assert log content.
- No unresolved contradictions detected across phases after sweep.
