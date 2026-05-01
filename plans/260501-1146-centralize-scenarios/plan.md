---
title: Centralize Scenarios
status: pending
created: 2026-05-01
blockedBy: []
blocks: []
---

# Centralize Scenarios — Implementation Plan

Merge `user_ai_scenarios` into `scenarios` as `type='personal'`. Fixes FK violation on `POST /scenario/chat`. Renames `default` → `system`.

**Source brainstorm:** `brainstorm-report.md`

## Phases

| # | Phase | Status | Files |
|---|---|---|---|
| 01 | Schema, enum, migration | pending | 3 |
| 02 | Repo helpers + privacy gate | pending | 1 |
| 03 | Service refactor + module cleanup | pending | 6 |
| 04 | DTOs + KOL/redeem guards | pending | 3 |
| 05 | Specs + verification | pending | 5 |

## Dependencies

- Phase 02 depends on 01 (entity must exist)
- Phase 03 depends on 02 (services use helpers)
- Phase 04 can run parallel with 03 (different files)
- Phase 05 last (tests verify everything)

## Key Decisions

- **Big-bang migration** — app not released
- **Skip RLS** — no per-request `app.user_id` plumbing exists
- **Option B premium gating** — owner without subscription is blocked from premium personal scenarios
- **Preserve UUIDs** during backfill to keep mobile/conversation refs working
- **Drop `user_ai_scenarios`** in same migration

## Out of Scope

- RLS rollout (separate hardening task)
- Mobile DTO coordination (`source: 'system'` literal change)
- TTL/cleanup for personal rows
- Admin tooling for inspecting personal scenarios
