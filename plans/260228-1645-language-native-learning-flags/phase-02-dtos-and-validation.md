# Phase 2: DTOs & Validation

## Context Links

- [Phase 1](phase-01-database-migration-and-entity.md) (dependency)
- Existing DTOs: `src/modules/language/dto/`
- DTO patterns: `add-user-language.dto.ts`, `language.dto.ts`

## Overview

- **Priority:** P1 (blocks Phase 3)
- **Status:** pending
- **Description:** Update `LanguageDto` response to include new flags. Create `LanguageQueryDto` for type filtering. Create `SetNativeLanguageDto` for the native language endpoint.

## Key Insights

- Existing DTOs use `@ApiProperty`/`@ApiPropertyOptional` from `@nestjs/swagger`
- Validation uses `class-validator` decorators: `@IsUUID()`, `@IsEnum()`, `@IsOptional()`
- Response DTOs only have `@ApiProperty`, no validation decorators (they're output-only)
- Input DTOs have both swagger + validation decorators

## Requirements

**Functional:**
- `LanguageDto` must expose `isNativeAvailable` and `isLearningAvailable`
- `LanguageQueryDto` accepts optional `type` param: `'native' | 'learning'`
- `SetNativeLanguageDto` requires `languageId` as UUID

**Non-functional:**
- Follow existing DTO patterns exactly
- Use `class-validator` for all input validation

## Architecture

```
LanguageDto (response) -- add 2 boolean fields
LanguageQueryDto (query input) -- new file, optional type enum
SetNativeLanguageDto (body input) -- new file, required languageId
```

## Related Code Files

| Action | File |
|--------|------|
| Modify | `src/modules/language/dto/language.dto.ts` |
| Create | `src/modules/language/dto/language-query.dto.ts` |
| Create | `src/modules/language/dto/set-native-language.dto.ts` |

## Implementation Steps

### 1. Update LanguageDto

Add flags to `src/modules/language/dto/language.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for language response (available languages list)
 */
export class LanguageDto {
  @ApiProperty({ description: 'Language ID' })
  id!: string;

  @ApiProperty({ description: 'Language code (e.g., en, vi, ja)' })
  code!: string;

  @ApiProperty({ description: 'Language name in English' })
  name!: string;

  @ApiProperty({ description: 'Language name in native script', required: false })
  nativeName?: string;

  @ApiProperty({ description: 'URL to language flag image', required: false })
  flagUrl?: string;

  @ApiProperty({ description: 'Available as native language option' })
  isNativeAvailable!: boolean;

  @ApiProperty({ description: 'Available as learning language option' })
  isLearningAvailable!: boolean;
}
```

### 2. Create LanguageQueryDto

Create `src/modules/language/dto/language-query.dto.ts`:

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum LanguageType {
  NATIVE = 'native',
  LEARNING = 'learning',
}

/**
 * DTO for filtering languages by type (native or learning)
 */
export class LanguageQueryDto {
  @ApiPropertyOptional({
    description: 'Filter languages by availability type',
    enum: LanguageType,
  })
  @IsOptional()
  @IsEnum(LanguageType)
  type?: LanguageType;
}
```

### 3. Create SetNativeLanguageDto

Create `src/modules/language/dto/set-native-language.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * DTO for setting user's native language
 */
export class SetNativeLanguageDto {
  @ApiProperty({ description: 'Language ID to set as native language' })
  @IsUUID()
  languageId!: string;
}
```

### 4. Verify build

Run `npm run build` to confirm all DTOs compile.

## Todo List

- [ ] Update `language.dto.ts` with `isNativeAvailable` and `isLearningAvailable`
- [ ] Create `language-query.dto.ts` with `LanguageType` enum and `LanguageQueryDto`
- [ ] Create `set-native-language.dto.ts` with `SetNativeLanguageDto`
- [ ] Verify `npm run build` succeeds

## Success Criteria

- `LanguageDto` includes both availability flags
- `LanguageQueryDto` validates `type` param against enum
- `SetNativeLanguageDto` validates `languageId` as UUID
- Swagger picks up all new `@ApiProperty` decorators
- Build passes

## Risk Assessment

- **Risk:** DTO field names not matching entity -- mitigated: using same camelCase names
- **Risk:** Import path issues for new enum -- mitigated: exporting from DTO file, same as `ProficiencyLevel` pattern

## Security Considerations

- Input validation on `languageId` (UUID format) prevents injection
- `type` param validated against enum -- rejects arbitrary values

## Next Steps

- Phase 3: Service and controller logic using these DTOs
