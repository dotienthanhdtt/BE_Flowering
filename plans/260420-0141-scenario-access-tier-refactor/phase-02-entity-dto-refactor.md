# Phase 02 — Entity + enum + DTO refactor

## Context Links
- Depends on: Phase 01 complete (schema ready)
- Entities: `src/database/entities/{scenario,lesson}.entity.ts`
- New enum file: `src/database/entities/access-tier.enum.ts`
- DTO: `src/modules/lesson/dto/lesson-response.dto.ts`, `src/modules/admin-content/dto/update-content.dto.ts`

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Update TypeORM entities to drop 3 bool fields, add `accessTier`. Introduce `AccessTier` enum. Update response DTOs: `ScenarioStatus` loses `TRIAL`, keeps `AVAILABLE|LOCKED|LEARNED`. Admin DTOs accept `accessTier`.

## Key Insights
- Keep `ScenarioStatus` (UI-facing) distinct from `ContentStatus` (lifecycle) — they solve different problems.
- `ScenarioStatus.TRIAL` removed: when a free user sees a free scenario, it is just `AVAILABLE`. No intermediate tier.
- `AccessTier` lives in its own enum file — separate from `ContentStatus` — clarifies the orthogonal axis (gating vs lifecycle).

## Requirements

### Functional
- New file `src/database/entities/access-tier.enum.ts` exports `AccessTier { FREE='free', PREMIUM='premium' }`
- `scenario.entity.ts` + `lesson.entity.ts`:
  - Remove `@Column isPremium`, `isTrial` (scenario only), `isActive`
  - Add `@Column({ type: 'enum', enum: AccessTier, default: AccessTier.FREE, name: 'access_tier' }) accessTier!: AccessTier`
- `lesson-response.dto.ts`:
  - Remove `ScenarioStatus.TRIAL` enum member
  - Update `@ApiProperty` decorators accordingly
- `update-content.dto.ts`:
  - Add optional `accessTier?: AccessTier` field with `@IsEnum(AccessTier)`

### Non-functional
- Files stay <200 lines (current sizes 62–88; trivially met)
- Export `AccessTier` from `src/database/entities/index.ts` for ergonomic imports

## Architecture

### Entity shape after refactor
```ts
@Entity('scenarios')
export class Scenario {
  // ... unchanged cols ...
  @Column({ type: 'enum', enum: AccessTier, default: AccessTier.FREE, name: 'access_tier' })
  accessTier!: AccessTier;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.PUBLISHED })
  status!: ContentStatus;
  // ...
}
```

### DTO impact
```ts
export enum ScenarioStatus {
  AVAILABLE = 'available',
  LOCKED    = 'locked',
  LEARNED   = 'learned',
}
```

## Related Code Files

**Create:**
- `src/database/entities/access-tier.enum.ts`

**Modify:**
- `src/database/entities/scenario.entity.ts` — drop 3 bool cols, add accessTier
- `src/database/entities/lesson.entity.ts` — drop 2 bool cols, add accessTier
- `src/database/entities/index.ts` — export new enum
- `src/modules/lesson/dto/lesson-response.dto.ts` — drop TRIAL, keep AVAILABLE/LOCKED/LEARNED
- `src/modules/admin-content/dto/update-content.dto.ts` — add optional accessTier

**Do not modify:**
- `scenario-category.entity.ts` (category has own `isActive`; out of scope)
- `user-language.entity.ts`, `language.entity.ts`, `subscription.entity.ts` (unrelated `isActive`)

## Implementation Steps

1. Create `src/database/entities/access-tier.enum.ts`:
   ```ts
   export enum AccessTier {
     FREE = 'free',
     PREMIUM = 'premium',
   }
   ```
2. Edit `scenario.entity.ts`:
   - Remove lines 68–75 (`isPremium`, `isTrial`, `isActive`)
   - Add `accessTier` column after `difficulty` and before `status`
   - Add `import { AccessTier } from './access-tier.enum'`
3. Edit `lesson.entity.ts`:
   - Remove lines 47–51 (`isPremium`, `isActive`)
   - Add `accessTier` column after `orderIndex` and before `status`
   - Add `import { AccessTier } from './access-tier.enum'`
4. Edit `src/database/entities/index.ts` — add `export * from './access-tier.enum'` (if index uses re-exports).
5. Edit `lesson-response.dto.ts` — remove `TRIAL = 'trial'` enum member.
6. Edit `update-content.dto.ts` — add:
   ```ts
   @ApiPropertyOptional({ enum: AccessTier })
   @IsOptional()
   @IsEnum(AccessTier)
   accessTier?: AccessTier;
   ```
7. Run `npm run build` — expect failures in consuming services (Phase 03 target).

## Todo List
- [x] Create `access-tier.enum.ts`
- [x] Update `scenario.entity.ts`
- [x] Update `lesson.entity.ts`
- [x] Update `entities/index.ts`
- [x] Update `lesson-response.dto.ts`
- [x] Update `update-content.dto.ts`
- [x] Confirm `npm run build` TS errors only in expected consumer files (Phase 03 scope)

## Success Criteria
- `grep -n "isPremium\|isTrial\|isActive" src/database/entities/scenario.entity.ts src/database/entities/lesson.entity.ts` → 0 matches
- `AccessTier` enum importable from `src/database/entities`
- `ScenarioStatus.TRIAL` no longer exists in codebase
- Remaining TS errors after this phase point only to files listed in Phase 03

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missed DTO consumer (e.g. Swagger docs) | Low | Low | Phase 06 docs sync catches |
| `entities/index.ts` does not re-export enums currently | Low | Low | Inspect file; if raw class exports only, direct import from `./access-tier.enum` works fine |
| `@IsEnum(AccessTier)` import path | Low | Low | class-validator already used in DTO module |

## Security Considerations
- No change. accessTier is enforced server-side in Phase 03 services, not trusted from client input.

## Next Steps
- Phase 03 consumes new entity shape (compile errors resolve then)
