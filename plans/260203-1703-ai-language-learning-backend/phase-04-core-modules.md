# Phase 04: Core Modules (User, Language)

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | completed |
| Effort | 2h |
| Dependencies | Phase 02, Phase 03 |

Implement core business modules: User (CRUD, profile), Language (available languages, user learning languages).

## Key Insights

- Each module follows NestJS module pattern (controller, service, DTOs)
- TypeORM repositories for database operations
- Swagger decorators on all endpoints

## Requirements

### Functional
- User profile CRUD (get, update)
- List available languages
- Manage user's learning languages

### Non-Functional
- Response time <200ms for all endpoints
- Soft delete for user accounts

## Architecture

```
src/modules/
├── user/
│   ├── user.module.ts
│   ├── user.controller.ts
│   ├── user.service.ts
│   └── dto/
│       ├── user-profile.dto.ts
│       └── update-user.dto.ts
└── language/
    ├── language.module.ts
    ├── language.controller.ts
    ├── language.service.ts
    └── dto/
        ├── language.dto.ts
        ├── user-language.dto.ts
        └── add-user-language.dto.ts
```

## Related Code Files

### User Module
- `src/modules/user/user.module.ts`
- `src/modules/user/user.controller.ts`
- `src/modules/user/user.service.ts`
- `src/modules/user/dto/user-profile.dto.ts`
- `src/modules/user/dto/update-user.dto.ts`

### Language Module
- `src/modules/language/language.module.ts`
- `src/modules/language/language.controller.ts`
- `src/modules/language/language.service.ts`
- `src/modules/language/dto/language.dto.ts`
- `src/modules/language/dto/user-language.dto.ts`
- `src/modules/language/dto/add-user-language.dto.ts`

## Implementation Steps

### Step 1: User Module (60min)

```typescript
// src/modules/user/user.controller.ts
@ApiTags('users')
@Controller('users')
export class UserController {
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: User): Promise<UserProfileDto> {
    return this.userService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ): Promise<UserProfileDto> {
    return this.userService.update(user.id, dto);
  }
  
}

// src/modules/user/user.service.ts
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['nativeLanguage'],
    });
    return this.mapToProfileDto(user);
  }

  async update(userId: string, dto: UpdateUserDto): Promise<UserProfileDto> {
    await this.userRepo.update(userId, dto);
    return this.getProfile(userId);
  }

}
```

### Step 2: Language Module (60min)

```typescript
// src/modules/language/language.controller.ts
@ApiTags('languages')
@Controller('languages')
export class LanguageController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'List all available languages' })
  async getLanguages(): Promise<LanguageDto[]> {
    return this.languageService.findAll();
  }

  @Get('user')
  @ApiOperation({ summary: 'Get user learning languages' })
  async getUserLanguages(@CurrentUser() user: User): Promise<UserLanguageDto[]> {
    return this.languageService.getUserLanguages(user.id);
  }

  @Post('user')
  @ApiOperation({ summary: 'Add language to user learning list' })
  async addUserLanguage(
    @CurrentUser() user: User,
    @Body() dto: AddUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.addUserLanguage(user.id, dto);
  }

  @Patch('user/:languageId')
  @ApiOperation({ summary: 'Update user language proficiency' })
  async updateUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId') languageId: string,
    @Body() dto: UpdateUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.updateUserLanguage(user.id, languageId, dto);
  }

  @Delete('user/:languageId')
  @ApiOperation({ summary: 'Remove language from user learning list' })
  async removeUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId') languageId: string,
  ): Promise<void> {
    return this.languageService.removeUserLanguage(user.id, languageId);
  }
}

// src/modules/language/language.service.ts
@Injectable()
export class LanguageService {
  async findAll(): Promise<LanguageDto[]> {
    return this.languageRepo.find({ where: { isActive: true } });
  }

  async getUserLanguages(userId: string): Promise<UserLanguageDto[]> {
    return this.userLanguageRepo.find({
      where: { userId },
      relations: ['language'],
    });
  }

  async addUserLanguage(userId: string, dto: AddUserLanguageDto): Promise<UserLanguageDto> {
    const userLanguage = this.userLanguageRepo.create({
      userId,
      languageId: dto.languageId,
      proficiencyLevel: dto.proficiencyLevel || 'beginner',
    });
    return this.userLanguageRepo.save(userLanguage);
  }
}
```

### Step 3: Register Modules in AppModule (15min)

```typescript
// src/app.module.ts
@Module({
  imports: [
    // ... existing imports
    UserModule,
    LanguageModule,
  ],
})
export class AppModule {}
```

## Todo List

### User Module
- [x] Create UserModule
- [x] Create UserController (GET/PATCH /users/me)
- [x] Create UserService
- [x] Create UserProfileDto
- [x] Create UpdateUserDto

### Language Module
- [x] Create LanguageModule
- [x] Create LanguageController
- [x] Create LanguageService
- [x] Create LanguageDto
- [x] Create UserLanguageDto
- [x] Create AddUserLanguageDto

### Common
- [x] Register all modules in AppModule
- [ ] Write unit tests for services
- [ ] Write e2e tests for controllers

## Success Criteria

- [x] GET /users/me returns user profile
- [x] PATCH /users/me updates profile
- [x] GET /languages returns active languages
- [x] GET /languages/user returns user's learning languages
- [x] POST /languages/user adds language
- [x] PATCH /languages/user/:id updates proficiency
- [x] DELETE /languages/user/:id removes language
- [x] All endpoints have Swagger documentation

## Risk Assessment  

| Risk             | Likelihood | Impact | Mitigation                          |
| ---------------- | ---------- | ------ | ----------------------------------- |
| N+1 query issues | Medium     | Medium | Use TypeORM relations, eager loading |

## Security Considerations

- Users can only access their own data
- RLS policies enforce data isolation
- No direct DB access, only through services
