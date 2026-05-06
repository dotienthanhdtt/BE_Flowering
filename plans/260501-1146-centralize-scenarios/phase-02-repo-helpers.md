# Phase 02 — Repo Helpers + Privacy Gate

**Priority:** P0
**Status:** pending
**Depends on:** Phase 01

## Context Links

- `brainstorm-report.md` § Privacy Strategy
- `src/modules/scenario/services/scenario-access.service.ts`

## Overview

Add three helper methods that encode owner-aware filters. Convention: services call only these helpers, never `scenarioRepo` directly.

## Requirements

- `findVisibleToUser(userId, scenarioId, languageId?)` — owner-aware single fetch
- `listPublicByType(type, languageId, paging)` — public catalog
- `listPersonalForUser(userId, languageId, paging)` — owned personal scenarios

## Files

**Modify:**
- `src/modules/scenario/services/scenario-access.service.ts`

## Implementation Steps

1. Inside `ScenarioAccessService`, add `findVisibleToUser(userId, scenarioId, languageId?)`:
   ```
   const scenario = await this.scenarioRepo.findOne({
     where: [
       { id: scenarioId, status: PUBLISHED, ownerId: IsNull(), ...(languageId ? {languageId} : {}) },
       { id: scenarioId, status: PUBLISHED, ownerId: userId,   ...(languageId ? {languageId} : {}) },
     ],
     relations: ['category'],
   });
   if (!scenario) throw new NotFoundException('Scenario not found');
   if (languageId && scenario.languageId !== languageId) throw new NotFoundException(...);
   return scenario;
   ```
2. Refactor existing `fetchPublishedScenario(scenarioId, languageId?)` to accept `userId` and call `findVisibleToUser`. Both `findAccessibleScenario` and `checkAccess` already pass `userId` — minor signature change.
3. Add `listPublicByType(type, languageId, page, limit)` — returns `[rows, total]` with `findAndCount` and `where: { type, status: PUBLISHED, ownerId: IsNull(), languageId }`.
4. Add `listPersonalForUser(userId, languageId, page, limit)` — `where: { type: PERSONAL, ownerId: userId, languageId }`.
5. Premium gating in `findAccessibleScenario` / `checkAccess` runs uniformly (Option B). No owner short-circuit.

## Todo

- [ ] `findVisibleToUser` implemented
- [ ] `fetchPublishedScenario` updated to use helper
- [ ] `listPublicByType` implemented
- [ ] `listPersonalForUser` implemented
- [ ] `npm run build` passes

## Success Criteria

- Three helpers exist with type-safe signatures
- All read paths in `ScenarioAccessService` route through helpers
- Premium check unchanged — applies uniformly

## Risks

| Risk | Mitigation |
|---|---|
| `findOne` with array `where` performance | Postgres planner uses index on `(id)` — fine |
| Forgetting `relations: ['category']` for personal rows | Personal has null category; loaded as null — OK |
