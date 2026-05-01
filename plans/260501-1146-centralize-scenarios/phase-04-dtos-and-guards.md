# Phase 04 — DTOs + KOL/Redeem Guards

**Priority:** P1
**Status:** pending
**Can run parallel with:** Phase 03

## Context Links

- `brainstorm-report.md` § Per-Flow Logic Post-Merge (KOL bundle, redeem)

## Overview

Update DTO types for new source literal and personal `imageUrl`. Add explicit type guards on KOL bundle attach and redeem to prevent personal rows leaking into public flows.

## Files

**Modify:**
- `src/modules/scenario/dto/scenario-detail.dto.ts`
- `src/modules/scenario/dto/scenario-personal.dto.ts`
- `src/modules/scenario/services/scenarios-redeem.service.ts`
- `src/modules/kol-bundle/kol-bundle.service.ts` (validate scenario type on attach)

## Implementation Steps

### DTOs
1. `scenario-detail.dto.ts`:
   - `ScenarioSource = 'system' | 'kol' | 'personalized'` (rename `'default'` → `'system'`)
   - Update `ApiPropertyOptional({ enum: [...] })` literals
2. `scenario-personal.dto.ts`:
   - Add `@ApiPropertyOptional() imageUrl?: string`

### Redeem guard
1. `scenarios-redeem.service.ts:redeem`:
   - Final scenario fetch: add `type: ScenarioType.KOL`, `ownerId: IsNull()` to the where clause
   - Defends against the case where a KOL bundle row was somehow attached to a personal scenario

### KOL bundle attach
1. `kol-bundle.service.ts`: in `attachScenarios` (or equivalent insert path), before insert into `kol_bundle_scenario`, fetch the scenarios and assert `s.type === KOL && s.ownerId === null`. Throw `BadRequestException` otherwise.

## Todo

- [ ] DTOs updated
- [ ] Redeem service guard added
- [ ] KOL bundle attach guard added
- [ ] `npm run build` passes

## Success Criteria

- Mobile-facing source literal returns `'system'`, `'kol'`, or `'personalized'`
- Personal scenarios cannot be attached to a KOL bundle (BadRequest)
- Redeem flow ignores any non-KOL row even if linked

## Risks

| Risk | Mitigation |
|---|---|
| Existing KOL bundles reference now-renamed type | Type rename is enum-level; existing rows still `type='kol'` — unaffected |
| Mobile breaks on `'system'` literal | App not released; coordinate before any client cut |
