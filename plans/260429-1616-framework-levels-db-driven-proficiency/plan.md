---
title: Framework levels DB-driven proficiency
status: completed
created: 2026-04-29
mode: standard
blockedBy: []
blocks: []
---

# Framework Levels — DB-Driven Proficiency

## Goal
Move proficiency-level resolution + validation out of TypeScript into Postgres. Per-language `framework_levels` rows carry descriptions (in the learning language) and validation source. Code stops setting defaults; DB does it via trigger.

## Why
- Single source of truth for level metadata (descriptions editable without code deploy)
- Descriptions written in the learning language itself (N1 in Japanese, A1 in English, etc.)
- Removes duplicated default-pick logic in `language.service.ts` and `language-context.guard.ts`
- Enables future admin UI to manage level descriptions per language

## Scope
- `user_languages.proficiency_level` keeps `VARCHAR(16)` but loses default; trigger fills it
- `framework_levels(language_id, framework_code, level_code, description, order_index)` per-language table
- All `LANGUAGE_FRAMEWORKS`-based code paths replaced with DB-cached lookups
- `AllExceptionsFilter` maps Postgres `P0001` → 400
- `languages.level_framework` column dropped (Phase 05); framework code lives on `framework_levels` rows

## Phases

| # | File | Status |
|---|------|--------|
| 01 | [phase-01-create-framework-levels-table.md](./phase-01-create-framework-levels-table.md) | completed |
| 02 | [phase-02-trigger-and-user-languages-cleanup.md](./phase-02-trigger-and-user-languages-cleanup.md) | completed |
| 03 | [phase-03-code-refactor-remove-level-logic.md](./phase-03-code-refactor-remove-level-logic.md) | completed |
| 04 | [phase-04-exception-mapping-and-tests.md](./phase-04-exception-mapping-and-tests.md) | completed |
| 05 | [phase-05-restructure-framework-levels-per-language.md](./phase-05-restructure-framework-levels-per-language.md) | completed |
| 06 | [phase-06-code-refactor-per-language.md](./phase-06-code-refactor-per-language.md) | completed |

## Key Dependencies
- Phase 02 → Phase 01 (trigger reads from `framework_levels`)
- Phase 03 → Phase 02
- Phase 04 → Phase 03
- Phase 05 → Phase 04 (per-language redesign on top of shipped foundation)
- Phase 06 → Phase 05 (code follows DB shape)
