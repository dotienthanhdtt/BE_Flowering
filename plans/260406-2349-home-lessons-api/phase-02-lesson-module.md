# Phase 2: Lesson Module (Controller + Service + DTOs)

## Context
- [Phase 1](./phase-01-database-entities-migration.md) — entities must exist first
- Pattern reference: `src/modules/language/` (controller + service + DTOs)

## Overview
- **Priority:** High
- **Status:** completed
- **Blocked by:** Phase 1 (unblocked)

## Files to Create

### 1. `src/modules/lesson/dto/get-lessons-query.dto.ts`
Query params with validation:
```typescript
class GetLessonsQueryDto {
  @IsOptional() @IsUUID() language?: string;
  @IsOptional() @IsEnum(ScenarioDifficulty) level?: ScenarioDifficulty;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number = 20;
}
```

### 2. `src/modules/lesson/dto/lesson-response.dto.ts`
Response shape DTOs:
```typescript
class ScenarioItemDto {
  id: string;
  title: string;
  imageUrl: string | null;
  difficulty: ScenarioDifficulty;
  status: 'available' | 'trial' | 'locked' | 'learned';
}

class CategoryWithScenariosDto {
  id: string;
  name: string;
  icon: string | null;
  scenarios: ScenarioItemDto[];
}

class GetLessonsResponseDto {
  categories: CategoryWithScenariosDto[];
  pagination: { page: number; limit: number; total: number };
}
```

### 3. `src/modules/lesson/lesson.service.ts`
Core query logic:

```typescript
@Injectable()
export class LessonService {
  constructor(
    @InjectRepository(Scenario) scenarioRepo,
    @InjectRepository(ScenarioCategory) categoryRepo,
    @InjectRepository(UserScenarioAccess) accessRepo,
    @InjectRepository(UserProgress) progressRepo,
    @InjectRepository(Subscription) subscriptionRepo,
  ) {}

  async getLessons(userId: string, query: GetLessonsQueryDto): Promise<GetLessonsResponseDto> {
    // 1. Build scenario query with visibility filter
    //    WHERE is_active = true
    //    AND (language_id IS NULL OR language_id = :lang OR id IN user_scenario_access)
    //    AND (difficulty = :level if provided)
    //    AND (title ILIKE %search% if provided)
    //    ORDER BY category.order_index, scenario.order_index

    // 2. Get user subscription for status computation
    //    Single query: findOne where userId

    // 3. Get user progress for learned status
    //    Map of lessonId → status (batch query for matching scenario IDs)
    //    Note: UserProgress references Lesson, not Scenario
    //    For MVP: only Scenario-based status. Wire UserProgress later when Scenario→Lesson link exists.

    // 4. Compute status per scenario:
    //    learned: progress completed (future)
    //    locked: is_premium && user plan = FREE && !is_trial
    //    trial: is_trial && user plan = FREE
    //    available: everything else

    // 5. Group by category, apply pagination on total scenarios count
    // 6. Return grouped response
  }
}
```

**Status computation logic:**
```typescript
function computeStatus(scenario, subscription): ScenarioStatus {
  // Future: check UserProgress for 'learned'
  const isFreeUser = !subscription || subscription.plan === 'free';
  if (scenario.isPremium && isFreeUser && !scenario.isTrial) return 'locked';
  if (scenario.isTrial && isFreeUser) return 'trial';
  return 'available';
}
```

### 4. `src/modules/lesson/lesson.controller.ts`
```typescript
@ApiTags('lessons')
@Controller('lessons')
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get home screen lessons grouped by category' })
  async getLessons(
    @CurrentUser() user: User,
    @Query() query: GetLessonsQueryDto,
  ): Promise<GetLessonsResponseDto> {
    return this.lessonService.getLessons(user.id, query);
  }
}
```

### 5. `src/modules/lesson/lesson.module.ts`
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([
    Scenario, ScenarioCategory, UserScenarioAccess,
    UserProgress, Subscription
  ])],
  controllers: [LessonController],
  providers: [LessonService],
  exports: [LessonService],
})
export class LessonModule {}
```

### 6. Modify `src/app.module.ts`
Add `LessonModule` to imports array.

## Implementation Steps
1. Create `get-lessons-query.dto.ts` with validation decorators
2. Create `lesson-response.dto.ts` with response shapes
3. Create `lesson.service.ts` with query builder + status computation
4. Create `lesson.controller.ts` with GET endpoint
5. Create `lesson.module.ts` registering repos + providers
6. Add `LessonModule` to `app.module.ts` imports
7. Run `npm run build` to verify
8. Test via Swagger at `/api/docs`

## Query Performance Notes
- Visibility filter uses index on `language_id` + subquery on `user_scenario_access(user_id)`
- Category grouping done in application layer (TypeORM query returns flat, service groups)
- Pagination counts total matching scenarios, not categories

## Todo
- [x] Query DTO with validation
- [x] Response DTOs
- [x] LessonService with query builder
- [x] Status computation helper
- [x] LessonController
- [x] LessonModule
- [x] Register in app.module.ts
- [x] Build check passes

## Success Criteria
- `GET /lessons?language=uuid` returns grouped response
- Status correctly computed based on subscription
- Search, level filters work
- Pagination returns correct total
- Swagger docs show endpoint
