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
Move proficiency-level resolution + validation out of TypeScript into Postgres. Add shared per-(framework, level) descriptions in a new `framework_levels` lookup table. Code stops setting defaults; DB does it via trigger.

## Why
- Single source of truth for level metadata (descriptions editable without code deploy)
- Removes duplicated default-pick logic in `language.service.ts` and `language-context.guard.ts`
- Enables future admin UI to manage level descriptions
- Frontend can render level descriptions without hard-coded copy

## Scope
- `user_languages.proficiency_level` keeps `VARCHAR(16)` but loses default; trigger fills it
- New `framework_levels(framework_code, level_code, description, order_index)` table
- All existing `LANGUAGE_FRAMEWORKS`-based code paths replaced with DB queries
- `AllExceptionsFilter` learns to map Postgres `P0001` → 400

## Non-goals
- No change to gamification/XP system (separate concern)
- No rename of `proficiency_level` column
- No FK migration on `user_languages` (trigger handles validation; cross-table FK awkward)

## Phases

| # | File | Status |
|---|------|--------|
| 01 | [phase-01-create-framework-levels-table.md](./phase-01-create-framework-levels-table.md) | completed |
| 02 | [phase-02-trigger-and-user-languages-cleanup.md](./phase-02-trigger-and-user-languages-cleanup.md) | completed |
| 03 | [phase-03-code-refactor-remove-level-logic.md](./phase-03-code-refactor-remove-level-logic.md) | completed |
| 04 | [phase-04-exception-mapping-and-tests.md](./phase-04-exception-mapping-and-tests.md) | completed |

## Key Dependencies
- Phase 02 depends on Phase 01 (trigger reads from `framework_levels`)
- Phase 03 depends on Phase 02 (code can omit level only after DB defaults work)
- Phase 04 depends on Phase 03

## Open Items (resolve before Phase 01)
1. Description copy — placeholder `'TBD'` for now or canonical text from CEFR/JLPT bodies?
2. Confirm `LanguageDto.levels[]` may become `{ code, description }[]` (frontend impact)
