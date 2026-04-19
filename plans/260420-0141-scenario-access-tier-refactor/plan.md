---
title: "Scenario/Lesson access-tier refactor — eliminate flag soup"
description: "Replace isPremium/isTrial/isActive with single accessTier enum + rely on ContentStatus for lifecycle"
status: completed
priority: P2
effort: 5h
branch: dev
tags: [refactor, database, migration, scenarios, lessons, breaking-change]
created: 2026-04-20
---

## Goal

Collapse 3 overlapping boolean flags on `scenarios` and `lessons` (`is_premium`, `is_trial`, `is_active`) into a single `access_tier` enum (`free`, `premium`). Rely on existing `status` column (`ContentStatus`) for active/archived lifecycle. Trial concept is collapsed into free (clarified by product).

## Final data model

| Field removed       | Replacement                                 |
| ------------------- | ------------------------------------------- |
| `is_active`         | `status = 'published'` means active         |
| `is_premium`        | `access_tier = 'premium'`                   |
| `is_trial`          | Collapsed into `access_tier = 'free'`       |

New enum: `AccessTier { FREE = 'free', PREMIUM = 'premium' }`
Existing enum kept: `ContentStatus { DRAFT, PUBLISHED, ARCHIVED }`

Applies to BOTH `scenarios` and `lessons` tables (same flag smell verified).

## Breaking-change scope (app not yet released)

No backward compatibility. Mobile DTO field `status: 'trial'` is removed; replace with 2-value status.

## Phases

| # | Phase                                                                                              | Status      | Effort |
|---|----------------------------------------------------------------------------------------------------|-------------|--------|
| 1 | [DB migration — drop 3 bool cols, add access_tier enum](phase-01-db-migration.md)                  | completed   | 45m    |
| 2 | [Entity + enum + DTO refactor](phase-02-entity-dto-refactor.md)                                    | completed   | 30m    |
| 3 | [Service layer refactor (access, chat, admin-content, lesson)](phase-03-service-layer-refactor.md) | completed   | 60m    |
| 4 | [Seed data + admin prompt update](phase-04-seed-and-prompts.md)                                    | completed   | 20m    |
| 5 | [Tests update + new invariant tests](phase-05-tests.md)                                            | completed   | 90m    |
| 6 | [Docs sync (codebase-summary, system-architecture, api-docs, mobile-ref)](phase-06-docs.md)        | completed   | 25m    |

## Dependency graph

```
Phase 1 (migration) ──▶ Phase 2 (entity/DTO) ──▶ Phase 3 (services) ──┬─▶ Phase 5 (tests)
                                                                      │
                                              Phase 4 (seed/prompts) ─┘
                                                                       └─▶ Phase 6 (docs)
```

Phases 1–3 strictly sequential. Phase 4 can overlap with 3 (different files). Phase 5 must run after 3+4. Phase 6 last.

## File ownership (no conflicts)

- Phase 1: `src/database/migrations/1777001000000-refactor-content-access-tier.ts` (new only)
- Phase 2: `src/database/entities/{scenario,lesson}.entity.ts`, `src/database/entities/access-tier.enum.ts` (new), `src/modules/lesson/dto/lesson-response.dto.ts`
- Phase 3: `src/modules/{scenario/services/scenario-access,lesson/lesson,admin-content/admin-content}.service.ts`
- Phase 4: `src/database/seeds/scenario-seed-data.ts`, `src/modules/admin-content/prompts/*.md`
- Phase 5: `**/*.spec.ts` (tester-owned)
- Phase 6: `docs/{codebase-summary,system-architecture,api-documentation,mobile-api-reference}.md`

## Rollback

- Phase 1 migration is reversible (`down()` restores 3 bool cols from `access_tier` + `status`)
- Later phases are code-only; `git revert` on the phase commit is sufficient
- Deploy order: migrate DB → deploy new code. Brief window where old code sees new schema fails reads → minimize with single deploy window.

## Success criteria (observable)

- [x] `npm run build` passes (no TS errors)
- [x] `npm test` passes — all existing + new tests green
- [x] `npm run migration:run` applies; `npm run migration:revert` restores schema
- [x] `psql` check: `SELECT DISTINCT access_tier FROM scenarios` returns only `free|premium`
- [x] `grep -r "isPremium\|isTrial\|isActive" src/modules src/database/entities src/database/seeds` returns 0 hits (except unrelated `Subscription.isActive`, `ScenarioCategory.isActive`, `Language.isActive`, `UserLanguage.isActive` which are out-of-scope)
- [x] Mobile-facing `ScenarioStatus` enum no longer exposes `trial`
- [x] Swagger at `/api/docs` reflects new schema

## Unresolved questions

1. Should `ScenarioCategory.isActive` also migrate to `status`? Out of scope per user instruction — category is simpler (2 states). Leave as-is.
2. Should `access_tier` live on `scenario_categories` too for future category-wide gating? YAGNI — defer until needed.
