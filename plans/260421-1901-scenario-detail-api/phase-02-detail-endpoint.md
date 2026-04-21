# Phase 02 — Detail Endpoint (DTO + Service + Controller + Tests)

## Context Links

- Brainstorm: `plans/reports/brainstorm-260421-1901-scenario-detail-api.md` §4
- Overview plan: `plan.md`
- Depends on: Phase 01 (`checkAccess` method must exist)

## Overview

**Priority:** P1
**Status:** completed
**Effort:** 1.5h

Add `GET /scenarios/:id` endpoint. Create `ScenarioDetailDto`, `ScenariosDetailService`, register in module, wire controller with `@AutoEnrollLanguage()` + `X-Learning-Language` header. Cover with unit tests for 5 behavior-matrix rows.

## Key Insights

- Response wrapper handled globally by `ResponseTransformInterceptor` — service returns raw DTO, no manual `{code, message, data}` wrapping.
- `@AutoEnrollLanguage()` decorator + `@ActiveLanguage()` param already handles header resolution; reuse from `scenarios.controller.ts` list handlers.
- Use `ClassSerializerInterceptor` pattern already in place via NestJS globals — no class-transformer decorators needed beyond `@ApiProperty`.

## Requirements

### Functional
- `GET /scenarios/:id` returns `ScenarioDetailDto`.
- Delegates to `ScenariosDetailService.get(userId, scenarioId, languageId)`.
- Returns 404 on hard errors (not found, wrong language) — inherited from `checkAccess`.
- Returns 200 with `isLocked` + `lockReason` for soft-locked premium scenarios.
- Swagger-documented with full response schema and all status codes.

### Non-functional
- Each new file <200 LoC.
- 100% coverage on the new service (5 rows).
- No N+1: single query via `checkAccess` already loads `category` relation.

## Architecture

```
ScenariosController.getById(userId, activeLang, params)
  └── ScenariosDetailService.get(userId, id, languageId)
        └── ScenarioAccessService.checkAccess(userId, id, languageId)   [from phase 01]
        └── map(scenario, isLocked, lockReason) -> ScenarioDetailDto
```

## Related Code Files

**Create:**
- `src/modules/scenario/dto/scenario-detail.dto.ts` — DTO + `CategoryRefDto` + `LockReason` type
- `src/modules/scenario/services/scenarios-detail.service.ts`
- `src/modules/scenario/services/scenarios-detail.service.spec.ts`

**Modify:**
- `src/modules/scenario/scenarios.controller.ts` — add `@Get(':id')` handler after existing routes
- `src/modules/scenario/scenarios.module.ts` — add `ScenariosDetailService` to `providers`

**No delete.**

## Implementation Steps

1. Create `scenario-detail.dto.ts`:
   ```ts
   export class CategoryRefDto {
     @ApiProperty() id!: string;
     @ApiProperty() name!: string;
   }

   export type LockReason = 'premium_required';

   export class ScenarioDetailDto {
     @ApiProperty() id!: string;
     @ApiProperty() title!: string;
     @ApiPropertyOptional() description?: string;
     @ApiPropertyOptional() imageUrl?: string;
     @ApiProperty({ enum: ScenarioDifficulty }) difficulty!: ScenarioDifficulty;
     @ApiProperty() languageId!: string;
     @ApiProperty() orderIndex!: number;
     @ApiProperty({ type: CategoryRefDto }) category!: CategoryRefDto;
     @ApiProperty({ enum: AccessTier }) accessTier!: AccessTier;
     @ApiProperty() isLocked!: boolean;
     @ApiPropertyOptional({ enum: ['premium_required'] }) lockReason?: LockReason;
   }
   ```
2. Create `scenarios-detail.service.ts`:
   ```ts
   @Injectable()
   export class ScenariosDetailService {
     constructor(private readonly access: ScenarioAccessService) {}

     async get(userId: string, scenarioId: string, languageId: string): Promise<ScenarioDetailDto> {
       const result = await this.access.checkAccess(userId, scenarioId, languageId);
       const { scenario } = result;
       return {
         id: scenario.id,
         title: scenario.title,
         description: scenario.description,
         imageUrl: scenario.imageUrl,
         difficulty: scenario.difficulty,
         languageId: scenario.languageId,
         orderIndex: scenario.orderIndex,
         category: { id: scenario.category.id, name: scenario.category.name },
         accessTier: scenario.accessTier,
         isLocked: result.isLocked,
         lockReason: result.isLocked ? result.lockReason : undefined,
       };
     }
   }
   ```
3. Modify `scenarios.controller.ts` — add handler:
   ```ts
   @Get(':id')
   @AutoEnrollLanguage()
   @ApiHeader(LANGUAGE_HEADER)
   @ApiOperation({ summary: 'Get scenario detail' })
   @ApiResponse({ status: 200, type: ScenarioDetailDto })
   @ApiResponse({ status: 401, description: 'Unauthorized' })
   @ApiResponse({ status: 404, description: 'Scenario not found or language mismatch' })
   getById(
     @CurrentUser() user: { id: string },
     @ActiveLanguage() lang: ActiveLanguageContext,
     @Param('id', new ParseUUIDPipe()) id: string,
   ) {
     return this.detailService.get(user.id, id, lang.id);
   }
   ```
   Inject `detailService: ScenariosDetailService` in constructor.
4. Modify `scenarios.module.ts` — add `ScenariosDetailService` to providers.
5. Create `scenarios-detail.service.spec.ts` — 5 tests:
   - FREE tier → isLocked=false, full DTO
   - PREMIUM + sub → isLocked=false
   - PREMIUM + grant → isLocked=false
   - PREMIUM + no access → isLocked=true, lockReason='premium_required'
   - Language mismatch / missing → propagates NotFoundException from access service
6. Run `npm run build` → `npm test -- scenarios-detail`.
7. Smoke test with curl against `npm run start:dev`:
   ```bash
   curl -H "Authorization: Bearer $JWT" -H "X-Learning-Language: en" \
     http://localhost:3000/scenarios/$SCENARIO_ID
   ```

## Todo List

- [x] `scenario-detail.dto.ts` created with DTO + CategoryRefDto + LockReason
- [x] `scenarios-detail.service.ts` created
- [x] `scenarios-detail.service.spec.ts` with 5 tests
- [x] Controller route `GET /scenarios/:id` added with UUID pipe + Swagger
- [x] Module providers updated
- [x] `npm run build` green
- [x] `npm test` fully green
- [x] Swagger at `/api/docs` renders endpoint correctly

## Success Criteria

- All 5 unit tests pass.
- Full test suite green (`npm test`).
- Build clean (`npm run build`).
- Swagger documentation renders `ScenarioDetailDto` schema with all fields.
- Smoke curl returns correct DTO shape for all 5 matrix cases.

## Risk Assessment

- **Risk:** `ParseUUIDPipe` rejects route `/scenarios/default` or `/scenarios/personal` order-matters. **Mitigation:** `@Get(':id')` declared AFTER `/default` and `/personal` — NestJS route matching is order-dependent for static vs param routes; verify by running list endpoints after adding detail route.
- **Risk:** Missing `ParseUUIDPipe` allows malformed IDs through → DB error. **Mitigation:** always use pipe on `:id` param.
- **Risk:** Forgot to register service in module → DI error at runtime. **Mitigation:** spec test instantiates via `Test.createTestingModule` and will catch missing provider.

## Security Considerations

- Global JWT guard already protects all routes (`be_flowering/CLAUDE.md` — "Global JWT Guard: All routes protected by default").
- `ParseUUIDPipe` prevents SQL-injection via malformed scenario IDs.
- No user-controlled field leaked beyond what list endpoints already expose.

## Next Steps

- Phase 03 documents the endpoint in `docs/api-documentation.md`.
