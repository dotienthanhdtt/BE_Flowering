---
title: "Language-Specific Proficiency Levels"
description: "Per-language level frameworks (CEFR/JLPT/HSK/TOPIK) replacing shared 5-tier enum."
status: pending
priority: P1
effort: 6h
branch: dev
tags: [language, proficiency, migration, database, dto, flutter]
created: 2026-04-21
brainstorm: plans/reports/brainstorm-260421-1846-language-specific-levels.md
blockedBy: []
blocks: []
---

# Language-Specific Proficiency Levels

Replace shared 5-tier `ProficiencyLevel` enum with per-language framework-native levels (CEFR / JLPT / HSK / TOPIK). Native-only languages (`vi`, `th`) stay frameworkless. Auto-migrate existing users. Zero AI-prompt rewrite (raw label substitution).

## Source
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md`

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | [Framework registry + helpers + unit tests](phase-01-framework-registry.md) | pending | 45m |
| 2 | [Entity + DTO + custom validator](phase-02-entity-dto-validator.md) | pending | 45m |
| 3 | [Database migration (schema + data backfill)](phase-03-database-migration.md) | pending | 1h |
| 4 | [Seed data + service validation wiring](phase-04-seed-and-service.md) | pending | 45m |
| 5 | [Onboarding save-path mapping](phase-05-onboarding-mapping.md) | pending | 30m |
| 6 | [Flutter model + LanguageLevelPicker widget](phase-06-flutter-picker.md) | pending | 1.5h |
| 7 | [Swagger + E2E + staging deploy](phase-07-swagger-e2e-deploy.md) | pending | 45m |

## Key Dependencies

- Phase 1 → 2 (validator imports registry)
- Phase 2 → 3 (migration references new entity columns)
- Phase 3 → 4 (seed relies on migrated schema)
- Phase 4 → 5 (onboarding uses `mapGenericToFramework` + framework-aware `addUserLanguage`)
- Phase 1 → 6 (Flutter constants mirror TS registry)
- All backend phases (1–5) → 7

## Scope Exclusions (locked)

- `src/modules/ai/prompts/scenario-chat-prompt.json` — UNTOUCHED (user directive). Behavioral consequence: its `'beginner'` literal check on line 21 will no longer match any migrated user. Accepted.
- `src/modules/ai/services/scenario-chat.service.ts` — UNTOUCHED for prompt flag injection. No `isBeginnerTier` work.
- No new grace shim accepting old generic strings from stale Flutter clients (reject with 400; revisit only if support data warrants).

## Unresolved Questions (carry forward)

- **Langfuse prompt-versioning**: does relaxing `chat.dto.ts` `proficiencyLevel` string enum require bumping a tracked prompt version? Check before phase 2.
- **Lesson content coverage at HSK5/HSK6 and C2**: data question — users can now select these tiers but content may not exist. Defer; not blocking.
- **Post-migration grace shim for stale clients**: recommend 400 rejection with helpful error; reassess after 48h staging telemetry.
