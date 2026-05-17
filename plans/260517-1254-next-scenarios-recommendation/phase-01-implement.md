---
phase: 1
title: "Implement"
status: pending
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Implement

## Overview
Add `ScenarioRecommenderService` that returns up to 2 next scenarios via a single SQL query. Wire into `ScenarioCompleteService` and expose via DTO field `next_scenarios`. Idempotent replays recompute (recommendations are not cached).

## Requirements
- Functional: priority waterfall as described in plan overview. Always include field, empty `[]` when no candidates.
- Non-functional: single query; no N+1; adds <50ms p95 to `/scenario/complete`.

## Architecture

### Query (single SQL, parameterized via QueryBuilder or raw)
```sql
SELECT
  s.id, s.title, s.description, s.image_url, s.access_tier, s.category_id,
  c.id   AS category_pk,
  c.name AS category_name,
  CASE
    WHEN s.access_tier = 'premium'
         AND :userIsPremium = false
         AND NOT EXISTS (
           SELECT 1 FROM user_scenario_access usa
           WHERE usa.user_id = :userId AND usa.scenario_id = s.id
         )
    THEN true ELSE false
  END AS is_locked,
  CASE
    WHEN :anchorCategoryId IS NOT NULL AND s.category_id = :anchorCategoryId THEN true
    ELSE false
  END AS same_category
FROM scenarios s
LEFT JOIN scenario_categories c ON c.id = s.category_id
WHERE s.language_id = :languageId
  AND s.status      = 'published'
  AND (s.owner_id IS NULL OR s.owner_id = :userId)
  AND s.id <> :anchorScenarioId
  AND NOT EXISTS (
    SELECT 1 FROM ai_conversations conv
    WHERE conv.user_id = :userId
      AND conv.scenario_id = s.id
      AND conv.status = 'done'
  )
ORDER BY
  (CASE
     WHEN NOT (
       s.access_tier = 'premium' AND :userIsPremium = false
       AND NOT EXISTS (SELECT 1 FROM user_scenario_access usa
                       WHERE usa.user_id = :userId AND usa.scenario_id = s.id)
     ) AND (:anchorCategoryId IS NOT NULL AND s.category_id = :anchorCategoryId) THEN 1
     WHEN NOT (
       s.access_tier = 'premium' AND :userIsPremium = false
       AND NOT EXISTS (SELECT 1 FROM user_scenario_access usa
                       WHERE usa.user_id = :userId AND usa.scenario_id = s.id)
     ) THEN 2
     WHEN (:anchorCategoryId IS NOT NULL AND s.category_id = :anchorCategoryId) THEN 3
     ELSE 4
   END) ASC,
  s.order_index ASC,
  s.created_at DESC
LIMIT 2;
```

Implementation note: prefer raw query via `DataSource.query` for clarity, or TypeORM QueryBuilder with `addSelect` for typed mapping — pick whichever the codebase favors elsewhere (check existing services for precedent).

### DTO additions (`dto/scenario-complete.dto.ts`)
```ts
export class NextScenarioCategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class NextScenarioItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true }) image_url!: string | null;
  @ApiProperty({ enum: AccessTier }) access_tier!: AccessTier;
  @ApiProperty({ type: () => NextScenarioCategoryDto, nullable: true })
  category!: NextScenarioCategoryDto | null;
  @ApiProperty() is_locked!: boolean;
}

// ScenarioCompleteResponseDto adds:
@ApiProperty({ type: [NextScenarioItemDto] })
next_scenarios!: NextScenarioItemDto[];
```

### Service: `scenario-recommender.service.ts`
```ts
@Injectable()
export class ScenarioRecommenderService {
  constructor(
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async recommendNext(
    userId: string,
    anchorScenarioId: string,
    anchorCategoryId: string | null,
    languageId: string,
  ): Promise<NextScenarioItemDto[]> {
    const isPremium = await this.subscriptionService.isUserPremium(userId);
    const rows = await this.scenarioRepo.query(/* SQL above */, [...params]);
    return rows.map(this.mapRow);
  }

  private mapRow(r: any): NextScenarioItemDto { /* snake_case mapping */ }
}
```

### Wiring in `scenario-complete.service.ts`
- Inject `ScenarioRecommenderService`
- After `buildResponse(...)` in all three return paths (cached success, cap-reached, fresh), call:
  ```ts
  response.next_scenarios = await this.recommender.recommendNext(
    userId, scenario.id, scenario.categoryId ?? null, languageId,
  );
  ```
  Centralize in a small helper to avoid 3× duplication. Alternative: have `buildResponse` accept the array.

### Module registration
`scenario.module.ts` → add `ScenarioRecommenderService` to providers + exports if needed.

## Related Code Files
- Create: `src/modules/scenario/services/scenario-recommender.service.ts`
- Modify: `src/modules/scenario/dto/scenario-complete.dto.ts` (add DTOs, add field)
- Modify: `src/modules/scenario/services/scenario-complete.service.ts` (inject + call + attach)
- Modify: `src/modules/scenario/scenario.module.ts` (provider registration)

## Implementation Steps
1. Add `NextScenarioCategoryDto`, `NextScenarioItemDto`, and `next_scenarios` field to `ScenarioCompleteResponseDto`.
2. Create `ScenarioRecommenderService` with `recommendNext()` (single SQL query + premium check).
3. Register the service in `scenario.module.ts`.
4. Inject into `ScenarioCompleteService`; populate `next_scenarios` on all three response branches via a small helper.
5. `npx tsc --noEmit` → must pass.
6. `npm run build` → must pass.
7. Smoke-test with `psql` against dev DB: `EXPLAIN ANALYZE` the query for a real user/scenario to confirm <50ms and index usage.

## Success Criteria
- [ ] DTO updated, field always present in response
- [ ] Service returns ≤2 items, correctly bucketed and ordered
- [ ] Premium user never gets `is_locked: true`
- [ ] Build + tsc clean
- [ ] `EXPLAIN ANALYZE` shows index seek on `idx_ai_conversations_user_scenario` for the `NOT EXISTS`

## Risk Assessment
- **Risk:** raw SQL drift if column names change. **Mitigation:** keep query in one place; cover with tests in Phase 2.
- **Risk:** subscription check adds a DB round-trip. **Mitigation:** `isUserPremium` already cached in `SubscriptionService`; verify.
- **Risk:** premium user with no explicit access still sees premium scenarios as `is_locked=false`. Confirmed correct per spec.
