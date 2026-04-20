---
title: "Scenario Type System"
description: "Introduce type discriminator on scenarios, split personalized into own table, add KOL bundles + redeem, replace isAdmin with roles[]"
status: done
priority: P1
effort: 14h
branch: dev
tags: [backend, scenarios, kol, roles, migration, api]
created: 2026-04-20
---

## Source Brainstorm

- [brainstorm-260420-1905-scenario-type-system.md](../reports/brainstorm-260420-1905-scenario-type-system.md) — all architecture decisions

## Goal

Add explicit `type` discriminator to `scenarios`, isolate AI-generated scenarios into `user_ai_scenarios`, introduce KOL bundles with gift-code redemption, and replace `users.isAdmin` boolean with extensible `users.roles text[]`. Ship `/scenarios/default`, `/scenarios/personal`, `POST /scenarios/redeem`.

## Phases

| # | Phase | File | Status | Blockers |
| --- | --- | --- | --- | --- |
| 01 | Database entities + migrations | [phase-01-database-schema.md](./phase-01-database-schema.md) | done | - |
| 02 | Role system refactor (isAdmin -> roles[]) | [phase-02-role-system-refactor.md](./phase-02-role-system-refactor.md) | done | 01 |
| 03 | Scenarios module (3 endpoints) | [phase-03-scenarios-module.md](./phase-03-scenarios-module.md) | done | 01, 02 |
| 04 | KOL bundle admin endpoints | [phase-04-kol-bundle-admin.md](./phase-04-kol-bundle-admin.md) | done | 01, 02 |
| 05 | Tests (unit + e2e) | [phase-05-tests.md](./phase-05-tests.md) | done | 03, 04 |
| 06 | Docs update | [phase-06-docs-update.md](./phase-06-docs-update.md) | done | 05 |

## Key Dependencies

- TypeORM migrations run in timestamp order — phase-01 must produce 5 new migration files
- `roles[]` refactor (phase-02) touches `admin.guard.ts`, `admin-content.service.ts`, user spec fixtures — must precede any new controller guards that check roles
- `ScenariosController` (phase-03) is a NEW controller at `/scenarios` (lives in `src/modules/scenario/`), coexists with existing `ScenarioChatController` at `/scenario` (different path)
- Phase-04 is tentative — see "Open Decisions" below

## Out of Scope (Deferred)

- **`user_ai_scenarios` seeding**: brainstorm defines flow (onboarding completion -> JSONB -> INSERT ON CONFLICT), but timing coupled to onboarding-flow finalization. Leave table empty; seed in separate plan.
- **Client `/lessons` -> `/scenarios/default` cutover**: client-side concern. Backend provides new endpoint; `/lessons` untouched.
- **Access tier (premium) gating on `/scenarios/default`**: brainstorm says "return all regardless of tier" — status computation lives in client if needed.

## Open Decisions

- **Bundle CRUD API scope**: brainstorm says "KOL creates bundle" but doesn't specify endpoint. Phase-04 drafts a minimal admin-only endpoint set (`POST /admin/kol-bundles`, `GET /admin/kol-bundles`, `POST /admin/kol-bundles/:id/scenarios`). If KOLs self-serve later, re-scope with a `KolGuard`. Confirm with product before building phase-04 — or strip it and seed bundles via SQL for MVP.

## Success Criteria

- [ ] 5 new migrations applied cleanly on a fresh DB and reversible (`migration:revert` works)
- [ ] All existing `isAdmin` references migrated; no references to removed `scenarios.gift_code` remain
- [ ] `GET /scenarios/default` returns paginated default scenarios for active language
- [ ] `GET /scenarios/personal` merges `user_ai_scenarios` + KOL-granted scenarios, sorted by `addedAt DESC`
- [ ] `POST /scenarios/redeem` is idempotent, rate-limited, normalizes code uppercase, returns full scenario list
- [ ] `npm run build` + `npm test` green; new e2e specs pass
