---
phase: 5
title: "Unified GET /scenarios endpoint"
status: completed
priority: P1
effort: "6h"
dependencies: [1, 2, 6]
---

# Phase 5: Unified GET /scenarios endpoint

## Overview
Replace `GET /scenarios/default` and `GET /scenarios/personal` with single `GET /scenarios` returning paginated categories with mixed-source scenarios. Sort categories by `order_index ASC`; within each category, sort scenarios by `COALESCE(usa.granted_at, s.created_at) DESC`. Hide empty categories.

## Requirements
- Functional: response shape `{ items: [{ category, scenarios[] }], pagination }`.
- Functional: hide categories with zero visible scenarios for `(userId, languageId)`.
- Functional: premium-lock stub semantics preserved (omit description/imageUrl for locked rows).
- Functional: `markLastLearned` from old `listDefault` invoked (currently runs only when default is fetched — keep behavior).
- Non-functional: two-query pagination (categories, then scenarios) avoids window-function fragility.

## Architecture

### Response DTO
```ts
class ScenarioListItemDto {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  languageId: string;
  type: 'system' | 'kol' | 'personal';
  source: 'system' | 'kol' | 'personalized';
  addedAt: Date;
  locked?: boolean;
}

class CategoryGroupDto {
  category: { id: string; name: string; slug: string; orderIndex: number };
  scenarios: ScenarioListItemDto[];
}

class ListScenariosGroupedResponseDto {
  items: CategoryGroupDto[];
  pagination: PaginationDto;
}
```

### Query strategy (two-query)
1. **Visible scenarios CTE-equivalent** (one query, returns flat rows + computed fields):
   ```sql
   WITH visible AS (
     SELECT s.id, s.title, s.description, s.image_url, s.language_id,
            s.category_id, s.access_tier, s.type, s.created_at,
            usa.granted_at,
            COALESCE(usa.granted_at, s.created_at) AS sort_at,
            CASE
              WHEN s.type = 'kol' THEN 'kol'
              WHEN s.type = 'personal' THEN 'personalized'
              ELSE 'system'
            END AS source
       FROM scenarios s
       LEFT JOIN user_scenario_access usa
              ON usa.scenario_id = s.id AND usa.user_id = :userId
      WHERE s.language_id = :languageId
        AND s.status = 'published'
        AND (
              (s.type = 'system' AND s.owner_id IS NULL)
           OR (s.type = 'personal' AND s.owner_id = :userId)
           OR (s.type = 'kol' AND usa.user_id IS NOT NULL AND s.owner_id IS NULL)
        )
   )
   SELECT v.*, c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug, c.order_index AS cat_order
     FROM visible v
     JOIN scenario_categories c ON c.id = v.category_id;
   ```
2. **Group + paginate in JS**:
   - Group by `cat_id`.
   - Sort categories by `cat_order ASC, cat_id ASC`.
   - Apply `(page-1)*limit` offset + `limit` window over distinct categories.
   - Within each kept category, sort scenarios by `sort_at DESC`.
   - Apply locked-stub transform from existing `scenarios-listing.service.ts` logic.

In-memory pagination acceptable: total scenarios per user+language is bounded (KOL+system catalog is small, personal capped at ~5/day × retention). If scale grows, switch to:
- Query 1: distinct `category_id` IDs sorted by `c.order_index` with LIMIT/OFFSET.
- Query 2: fetch visible scenarios filtered to those category IDs.

### Premium lock
Reuse existing rule from `scenarios-listing.service.ts:40-49`:
```ts
const locked = item.accessTier === 'premium' && !userIsPremium ? true : undefined;
if (locked) { description = undefined; imageUrl = undefined; }
```

### markLastLearned
Move existing `markLastLearned(userId, languageId)` into the unified listGrouped path; it sets `user_languages.last_learned` once per call.

## Related Code Files
- Modify: `src/modules/scenario/scenarios.controller.ts` — remove `/default` and `/personal`; add `GET /`.
- Modify: `src/modules/scenario/services/scenarios-listing.service.ts` — replace `listDefault`/`listPersonal` with `listGrouped`.
- Modify: `src/modules/scenario/services/scenario-access.service.ts` — likely needs a method `listVisibleForGrouping(userId, languageId)` if reusable.
- Modify: `src/modules/scenario/dto/list-scenarios-response.dto.ts` — add `CategoryGroupDto`, `ListScenariosGroupedResponseDto`.
- Modify: `src/modules/scenario/dto/scenario-default.dto.ts` + `scenario-personal.dto.ts` — collapse into single `scenario-list-item.dto.ts`.
- Modify: `src/modules/scenario/scenarios.module.ts` — register `ScenarioCategory` repository if not already.

## Implementation Steps
1. Add `ScenarioCategory` to `TypeOrmModule.forFeature` in scenarios module.
2. Create `scenario-list-item.dto.ts` and `category-group.dto.ts`; delete old `scenario-default.dto.ts`, `scenario-personal.dto.ts`, `list-scenarios-response.dto.ts` will be reshaped.
3. Implement `listGrouped` in `scenarios-listing.service.ts`. Keep `markLastLearned` private helper.
4. Delete `listDefault`, `listPersonal` methods.
5. Refactor controller: remove two endpoints, add unified `GET /` with `@ApiOperation`, `@AutoEnrollLanguage`, header doc, query DTO (same `ListScenariosQueryDto` for page/limit).
6. Run `npm run build`.
7. Manual smoke via Swagger:
   - Free user, default lang → groups returned, empty categories absent.
   - Premium user → no locked stubs.
   - User with redeemed KOL → KOL scenarios in correct category bucket.
   - User with personal scenarios → appear in inherited or `for_you` category.
8. Verify `markLastLearned` still updates `user_languages.last_learned` on each call.

## Success Criteria
- [ ] `GET /scenarios?page=1&limit=20` returns grouped response.
- [ ] Empty categories absent from output.
- [ ] Categories ordered by `order_index ASC`.
- [ ] Within-category items ordered by `COALESCE(granted_at, created_at) DESC`.
- [ ] `type` + `source` correct for each item.
- [ ] Locked stubs preserve premium semantics.
- [ ] `markLastLearned` invoked.
- [ ] Old endpoints return 404 (route removed).
- [ ] Build + existing scenario specs pass (specs updated in phase 7).

## Risk Assessment
- **Risk:** Mobile client still hitting `/default` or `/personal` after release → blank screens. **Mitigation:** coordinate hard cut with mobile release; mobile build pinned via version check; consider returning explicit 410 Gone with body explaining migration if mobile rollout slips (defer to release discussion).
- **Risk:** Pagination edge — user with 0 visible scenarios returns empty `items` and `total=0`. **Mitigation:** explicit test case.
- **Risk:** In-memory grouping balloons for power users with 100s of redeemed KOL. **Mitigation:** acceptable for now; switch to two-query strategy if listing exceeds 200 scenarios per call.
- **Risk:** Category language mismatch surfaces if phase 1 invariant fails. **Mitigation:** phase 1 success criteria + integration test in phase 7.
