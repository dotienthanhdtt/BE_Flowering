---
title: "Scenario Detail API (GET /scenarios/:id)"
description: "Dedicated detail endpoint returning title/description/category + soft-lock access state for scenario detail screen"
status: completed
priority: P1
effort: 3h
branch: dev
tags: [backend, scenarios, api, nestjs, detail-endpoint]
created: 2026-04-21
completed: 2026-04-21
brainstorm: plans/reports/brainstorm-260421-1901-scenario-detail-api.md
blockedBy: []
blocks: []
---

# Scenario Detail API

## Summary

Add `GET /scenarios/:id` — returns full scenario detail (title, description, image, difficulty, category) plus access metadata (`accessTier`, `isLocked`, `lockReason`). Any authenticated user sees detail for language-matched scenarios; premium scenarios return `isLocked=true` instead of 403 so the mobile app can render an upgrade CTA in a single round-trip.

Key refactor: promote the access-check logic inside `ScenarioAccessService` into a new non-throwing `checkAccess()` method that returns `{ scenario, isLocked, lockReason }`. Existing throwing `findAccessibleScenario()` (used by chat flow) stays untouched.

## Source

- Brainstorm: [brainstorm-260421-1901-scenario-detail-api.md](../reports/brainstorm-260421-1901-scenario-detail-api.md)

## Architecture Decisions (locked)

- Soft-lock via response flag, not 403 — enables single round-trip preview + upgrade CTA.
- Non-throwing `checkAccess` in access service — single source of truth; no try/catch control flow.
- Strict 404 on language mismatch — matches list-endpoint pattern; avoids cross-language leakage.
- No rate limit — user-triggered tap flow.
- No `type` field in response — not needed for v1 detail screen.

## Phases

| # | Phase | File | Status | Effort | Blockers |
|---|-------|------|--------|--------|----------|
| 01 | Access service refactor (non-throwing checkAccess) | [phase-01-access-service-refactor.md](./phase-01-access-service-refactor.md) | completed | 1h | — |
| 02 | Detail endpoint (DTO + service + controller + tests) | [phase-02-detail-endpoint.md](./phase-02-detail-endpoint.md) | completed | 1.5h | 01 |
| 03 | Docs update (api-documentation.md) | [phase-03-docs-update.md](./phase-03-docs-update.md) | completed | 30m | 02 |

## Key Files

**New:**
- `src/modules/scenario/dto/scenario-detail.dto.ts`
- `src/modules/scenario/services/scenarios-detail.service.ts`
- `src/modules/scenario/services/scenarios-detail.service.spec.ts`

**Modify:**
- `src/modules/scenario/services/scenario-access.service.ts` (add `checkAccess`)
- `src/modules/scenario/services/scenario-access.service.spec.ts` (cover new method)
- `src/modules/scenario/scenarios.controller.ts` (add `@Get(':id')`)
- `src/modules/scenario/scenarios.module.ts` (register new service)
- `docs/api-documentation.md` (document endpoint)

## Success Criteria

- [ ] 200 + full DTO for FREE scenario
- [ ] 200 + `isLocked=true, lockReason='premium_required'` for PREMIUM unsubscribed user
- [ ] 200 + `isLocked=false` for PREMIUM with active subscription OR explicit grant
- [ ] 404 for missing / unpublished / wrong-language scenario
- [ ] Unit tests cover 5 behavior-matrix rows
- [ ] Swagger renders `ScenarioDetailDto`
- [ ] `npm run build` + `npm test` green

## Dependencies

- Requires existing `ScenarioAccessService`, `SubscriptionService`, `AutoEnrollLanguage` decorator — all in place.
- No migrations, no entity changes.
