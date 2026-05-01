# Phase 03 — Service Refactor + Module Cleanup

**Priority:** P0
**Status:** pending
**Depends on:** Phase 02

## Context Links

- `brainstorm-report.md` § Per-Flow Logic Post-Merge

## Overview

Refactor four scenario services to use the helpers from Phase 02. Drop all `UserAiScenario` references. This phase fixes the original 500.

## Files

**Modify:**
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/services/scenarios-listing.service.ts`
- `src/modules/scenario/services/scenarios-detail.service.ts`
- `src/modules/scenario/scenarios.module.ts`
- `src/modules/scenario/scenario-chat.module.ts`

## Implementation Steps

### scenario-chat.service.ts
1. Drop `UserAiScenario` import, `userAiScenarioRepo` constructor injection.
2. Replace `resolveChatScenario` body with single call:
   ```ts
   const s = await this.scenarioAccessService.findVisibleToUser(userId, scenarioId, languageId);
   return { id: s.id, title: s.title, description: s.description ?? null,
            languageId: s.languageId, category: s.category ? { name: s.category.name } : null };
   ```
3. Remove fallback try/catch.

### scenarios-listing.service.ts
1. Drop `UserAiScenario` import + injection.
2. `listDefault` → `listPublicByType(ScenarioType.SYSTEM, ...)`. Update `where` to use `SYSTEM`.
3. `listPersonal`:
   - personal source: `this.access.listPersonalForUser(userId, languageId, page, limit)` (paginated)
   - KOL source: existing JOIN unchanged but add `s.owner_id IS NULL` filter
   - merge + sort by addedAt as today; `addedAt` for personal = `createdAt`
   - DTO `ScenarioPersonalDto.imageUrl` populated from `scenario.imageUrl`

### scenarios-detail.service.ts
1. Drop `UserAiScenario` import + injection.
2. Replace try/catch with single call to `access.checkAccess(userId, scenarioId, languageId)` — `checkAccess` now uses owner-aware fetch automatically.
3. Determine source:
   ```ts
   const source =
     scenario.type === ScenarioType.PERSONAL ? 'personalized' :
     scenario.type === ScenarioType.KOL ? 'kol' : 'system';
   ```
4. `category` field: `scenario.category ? {id, name} : undefined` (already supported by DTO).

### Module cleanup
- `scenarios.module.ts`: drop `UserAiScenario` from `TypeOrmModule.forFeature`
- `scenario-chat.module.ts`: drop `UserAiScenario` from `TypeOrmModule.forFeature`

## Todo

- [ ] scenario-chat.service refactored
- [ ] scenarios-listing.service refactored
- [ ] scenarios-detail.service refactored
- [ ] Both modules cleaned
- [ ] `npm run build` passes
- [ ] Manual smoke: `POST /scenario/chat` works for personal scenario

## Success Criteria

- No remaining `UserAiScenario` import in `src/modules/scenario/**`
- `POST /scenario/chat` succeeds end-to-end for personal scenario
- `GET /scenarios` returns only `type='system'` rows
- `GET /scenarios/personal` returns mixed personal + KOL
- `GET /scenarios/:id` returns correct source

## Risks

| Risk | Mitigation |
|---|---|
| KOL listing accidentally returns personal rows | Explicit `owner_id IS NULL` in JOIN query |
| Source literal mismatch with mobile | App not released — confirmed safe |
| `category` nullable surprises consumers | DTO already marks `category` optional |
