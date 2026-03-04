# Phase 3: Service & Controller Logic

## Context Links

- [Phase 1](phase-01-database-migration-and-entity.md), [Phase 2](phase-02-dtos-and-validation.md) (dependencies)
- Service: `src/modules/language/language.service.ts`
- Controller: `src/modules/language/language.controller.ts`
- Module: `src/modules/language/language.module.ts`

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Update `findAll()` to support type filter. Add `setNativeLanguage()` method. Update `addUserLanguage()` to validate `isLearningAvailable`. Wire controller endpoints. Add User entity to module imports.

## Key Insights

- User entity already has `nativeLanguageId` column and `nativeLanguage` relation -- no entity change needed
- Module currently imports `[Language, UserLanguage]` -- must add `User` for native language updates
- `findAll()` currently maps to `LanguageDto` manually -- must include new flags in mapping
- Controller uses `@Public()` on `GET /languages` -- must pass query params

## Requirements

**Functional:**
- `GET /languages?type=native` returns only `isNativeAvailable` languages
- `GET /languages?type=learning` returns only `isLearningAvailable` languages
- `GET /languages` (no type) returns all active languages (backward compat)
- `PATCH /languages/user/native` sets `user.nativeLanguageId` + validates `isNativeAvailable`
- `POST /languages/user` validates `isLearningAvailable` before allowing add

**Non-functional:**
- Error responses use NestJS exceptions (`NotFoundException`, `BadRequestException`)
- All DB writes in try-catch

## Architecture

```
Controller                    Service
GET /languages?type=...  -->  findAll(type?)     -- filter by availability flag
PATCH /languages/user/native  setNativeLanguage(userId, dto)  -- validate + update user
POST /languages/user     -->  addUserLanguage()  -- add isLearningAvailable check
```

## Related Code Files

| Action | File |
|--------|------|
| Modify | `src/modules/language/language.module.ts` |
| Modify | `src/modules/language/language.service.ts` |
| Modify | `src/modules/language/language.controller.ts` |

## Implementation Steps

### 1. Update language.module.ts

Add `User` entity import:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LanguageController } from './language.controller';
import { LanguageService } from './language.service';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Language, UserLanguage, User])],
  controllers: [LanguageController],
  providers: [LanguageService],
  exports: [LanguageService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LanguageModule {}
```

### 2. Update language.service.ts

#### 2a. Add User repository injection

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage, ProficiencyLevel } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { SetNativeLanguageDto } from './dto/set-native-language.dto';
import { LanguageType } from './dto/language-query.dto';

@Injectable()
export class LanguageService {
  constructor(
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}
  // ... methods below
}
```

#### 2b. Update findAll() to accept optional type filter

```typescript
async findAll(type?: LanguageType): Promise<LanguageDto[]> {
  const where: Record<string, unknown> = { isActive: true };

  if (type === LanguageType.NATIVE) {
    where.isNativeAvailable = true;
  } else if (type === LanguageType.LEARNING) {
    where.isLearningAvailable = true;
  }

  const languages = await this.languageRepo.find({
    where,
    order: { name: 'ASC' },
  });

  return languages.map((lang) => ({
    id: lang.id,
    code: lang.code,
    name: lang.name,
    nativeName: lang.nativeName,
    flagUrl: lang.flagUrl,
    isNativeAvailable: lang.isNativeAvailable,
    isLearningAvailable: lang.isLearningAvailable,
  }));
}
```

#### 2c. Add setNativeLanguage()

```typescript
/**
 * Set user's native language
 */
async setNativeLanguage(userId: string, dto: SetNativeLanguageDto): Promise<LanguageDto> {
  const language = await this.languageRepo.findOne({
    where: { id: dto.languageId, isActive: true },
  });

  if (!language) {
    throw new NotFoundException('Language not found');
  }

  if (!language.isNativeAvailable) {
    throw new BadRequestException('Language is not available as a native language');
  }

  await this.userRepo.update(userId, { nativeLanguageId: dto.languageId });

  return {
    id: language.id,
    code: language.code,
    name: language.name,
    nativeName: language.nativeName,
    flagUrl: language.flagUrl,
    isNativeAvailable: language.isNativeAvailable,
    isLearningAvailable: language.isLearningAvailable,
  };
}
```

#### 2d. Update addUserLanguage() validation

Add `isLearningAvailable` check after the existing language existence check:

```typescript
async addUserLanguage(userId: string, dto: AddUserLanguageDto): Promise<UserLanguageDto> {
  const language = await this.languageRepo.findOne({
    where: { id: dto.languageId, isActive: true },
  });

  if (!language) {
    throw new NotFoundException('Language not found');
  }

  if (!language.isLearningAvailable) {
    throw new BadRequestException('Language is not available for learning');
  }

  // ... rest unchanged (check existing, create, save, reload)
}
```

### 3. Update language.controller.ts

#### 3a. Add imports and new endpoint

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LanguageService } from './language.service';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { SetNativeLanguageDto } from './dto/set-native-language.dto';
import { LanguageQueryDto, LanguageType } from './dto/language-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public-route.decorator';
import { User } from '../../database/entities/user.entity';
```

#### 3b. Update getLanguages() to accept query param

```typescript
@Public()
@Get()
@ApiOperation({ summary: 'List available languages (optionally filter by type)' })
@ApiQuery({ name: 'type', enum: LanguageType, required: false })
async getLanguages(@Query() query: LanguageQueryDto): Promise<LanguageDto[]> {
  return this.languageService.findAll(query.type);
}
```

#### 3c. Add setNativeLanguage endpoint

Add this BEFORE the `PATCH user/:languageId` route to avoid route conflict:

```typescript
@ApiBearerAuth('JWT-auth')
@Patch('user/native')
@ApiOperation({ summary: 'Set user native language' })
async setNativeLanguage(
  @CurrentUser() user: User,
  @Body() dto: SetNativeLanguageDto,
): Promise<LanguageDto> {
  return this.languageService.setNativeLanguage(user.id, dto);
}
```

**IMPORTANT:** The `PATCH user/native` route must be defined BEFORE `PATCH user/:languageId` in the controller. Otherwise NestJS will match "native" as a `:languageId` param and `ParseUUIDPipe` will reject it.

### 4. Verify build

Run `npm run build`.

## Todo List

- [ ] Add `User` entity to `language.module.ts` imports
- [ ] Inject `User` repository in `language.service.ts`
- [ ] Update `findAll()` to accept `LanguageType` filter
- [ ] Update `findAll()` mapping to include new flags
- [ ] Add `setNativeLanguage()` method to service
- [ ] Add `isLearningAvailable` validation to `addUserLanguage()`
- [ ] Update `getLanguages()` controller to accept `LanguageQueryDto`
- [ ] Add `PATCH /languages/user/native` controller endpoint (before `:languageId`)
- [ ] Verify `npm run build` succeeds

## Success Criteria

- `GET /languages` returns all active languages with flags (backward compat)
- `GET /languages?type=native` filters correctly
- `GET /languages?type=learning` filters correctly
- `PATCH /languages/user/native` sets native language on user record
- `PATCH /languages/user/native` rejects non-native-available language
- `POST /languages/user` rejects non-learning-available language
- Route ordering correct (no `user/native` vs `user/:languageId` conflict)

## Risk Assessment

- **Risk:** Route conflict `user/native` vs `user/:languageId` -- mitigated: define `user/native` first in controller
- **Risk:** Missing User import in module -- mitigated: explicit in plan
- **Risk:** `findAll()` signature change breaks callers -- mitigated: param is optional, backward compat

## Security Considerations

- `setNativeLanguage` protected by JWT guard (no `@Public()`)
- User can only update their own native language (uses `@CurrentUser()`)
- Language validation prevents setting unavailable languages

## Next Steps

- Phase 4: Tests and API documentation
