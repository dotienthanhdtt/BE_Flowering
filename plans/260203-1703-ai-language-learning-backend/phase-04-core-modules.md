# Phase 04: Core Modules (User, Language, Lesson, Progress)

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | pending |
| Effort | 6h |
| Dependencies | Phase 02, Phase 03 |

Implement core business modules: User (CRUD, profile), Language (available languages, user learning languages), Lesson (lessons, exercises), and Progress (user progress tracking, exercise attempts).

## Key Insights

- Each module follows NestJS module pattern (controller, service, DTOs)
- Pagination on all list endpoints using cursor-based or offset pagination
- TypeORM repositories for database operations
- Swagger decorators on all endpoints

## Requirements

### Functional
- User profile CRUD (get, update, delete account)
- List available languages
- Manage user's learning languages
- List lessons by language with pagination
- Get lesson details with exercises
- Track user progress per lesson
- Record exercise attempts with feedback

### Non-Functional
- Response time <200ms for all endpoints
- Pagination default: 20 items per page
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
├── language/
│   ├── language.module.ts
│   ├── language.controller.ts
│   ├── language.service.ts
│   └── dto/
│       ├── language.dto.ts
│       └── user-language.dto.ts
├── lesson/
│   ├── lesson.module.ts
│   ├── lesson.controller.ts
│   ├── lesson.service.ts
│   └── dto/
│       ├── lesson.dto.ts
│       ├── lesson-detail.dto.ts
│       └── exercise.dto.ts
└── progress/
    ├── progress.module.ts
    ├── progress.controller.ts
    ├── progress.service.ts
    └── dto/
        ├── user-progress.dto.ts
        ├── submit-exercise.dto.ts
        └── exercise-result.dto.ts
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

### Lesson Module
- `src/modules/lesson/lesson.module.ts`
- `src/modules/lesson/lesson.controller.ts`
- `src/modules/lesson/lesson.service.ts`
- `src/modules/lesson/dto/lesson.dto.ts`
- `src/modules/lesson/dto/lesson-detail.dto.ts`
- `src/modules/lesson/dto/exercise.dto.ts`

### Progress Module
- `src/modules/progress/progress.module.ts`
- `src/modules/progress/progress.controller.ts`
- `src/modules/progress/progress.service.ts`
- `src/modules/progress/dto/user-progress.dto.ts`
- `src/modules/progress/dto/submit-exercise.dto.ts`
- `src/modules/progress/dto/exercise-result.dto.ts`

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

  @Delete('me')
  @ApiOperation({ summary: 'Delete user account (soft delete)' })
  async deleteAccount(@CurrentUser() user: User): Promise<void> {
    return this.userService.softDelete(user.id);
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

  async softDelete(userId: string): Promise<void> {
    await this.userRepo.softDelete(userId);
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

### Step 3: Lesson Module (90min)

```typescript
// src/modules/lesson/lesson.controller.ts
@ApiTags('lessons')
@Controller('lessons')
export class LessonController {
  @Get()
  @ApiOperation({ summary: 'List lessons by language' })
  @ApiQuery({ name: 'languageId', required: true })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getLessons(
    @Query('languageId') languageId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<PaginatedResponse<LessonDto>> {
    return this.lessonService.findByLanguage(languageId, { page, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lesson details with exercises' })
  async getLessonDetail(@Param('id') id: string): Promise<LessonDetailDto> {
    return this.lessonService.findOneWithExercises(id);
  }

  @Get(':id/exercises')
  @ApiOperation({ summary: 'Get exercises for a lesson' })
  async getExercises(@Param('id') lessonId: string): Promise<ExerciseDto[]> {
    return this.lessonService.getExercises(lessonId);
  }
}

// src/modules/lesson/lesson.service.ts
@Injectable()
export class LessonService {
  async findByLanguage(
    languageId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResponse<LessonDto>> {
    const [items, total] = await this.lessonRepo.findAndCount({
      where: { languageId },
      order: { orderIndex: 'ASC' },
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    });

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  async findOneWithExercises(id: string): Promise<LessonDetailDto> {
    const lesson = await this.lessonRepo.findOne({
      where: { id },
      relations: ['exercises'],
    });

    if (!lesson) throw new NotFoundException('Lesson not found');

    return {
      ...lesson,
      exercises: lesson.exercises.sort((a, b) => a.orderIndex - b.orderIndex),
    };
  }
}
```

### Step 4: Progress Module (90min)

```typescript
// src/modules/progress/progress.controller.ts
@ApiTags('progress')
@Controller('progress')
export class ProgressController {
  @Get()
  @ApiOperation({ summary: 'Get user progress for all lessons' })
  @ApiQuery({ name: 'languageId', required: false })
  async getProgress(
    @CurrentUser() user: User,
    @Query('languageId') languageId?: string,
  ): Promise<UserProgressDto[]> {
    return this.progressService.getUserProgress(user.id, languageId);
  }

  @Get('lessons/:lessonId')
  @ApiOperation({ summary: 'Get user progress for specific lesson' })
  async getLessonProgress(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ): Promise<UserProgressDto> {
    return this.progressService.getLessonProgress(user.id, lessonId);
  }

  @Post('lessons/:lessonId/start')
  @ApiOperation({ summary: 'Start a lesson' })
  async startLesson(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ): Promise<UserProgressDto> {
    return this.progressService.startLesson(user.id, lessonId);
  }

  @Post('exercises/:exerciseId/submit')
  @ApiOperation({ summary: 'Submit exercise answer' })
  async submitExercise(
    @CurrentUser() user: User,
    @Param('exerciseId') exerciseId: string,
    @Body() dto: SubmitExerciseDto,
  ): Promise<ExerciseResultDto> {
    return this.progressService.submitExercise(user.id, exerciseId, dto);
  }

  @Post('lessons/:lessonId/complete')
  @ApiOperation({ summary: 'Mark lesson as completed' })
  async completeLesson(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ): Promise<UserProgressDto> {
    return this.progressService.completeLesson(user.id, lessonId);
  }
}

// src/modules/progress/progress.service.ts
@Injectable()
export class ProgressService {
  async submitExercise(
    userId: string,
    exerciseId: string,
    dto: SubmitExerciseDto,
  ): Promise<ExerciseResultDto> {
    const exercise = await this.exerciseRepo.findOne({ where: { id: exerciseId } });
    if (!exercise) throw new NotFoundException('Exercise not found');

    const isCorrect = this.checkAnswer(exercise, dto.answer);
    const feedback = this.generateFeedback(exercise, dto.answer, isCorrect);

    const attempt = await this.attemptRepo.save({
      userId,
      exerciseId,
      userAnswer: dto.answer,
      isCorrect,
      feedback,
    });

    return {
      isCorrect,
      feedback,
      correctAnswer: isCorrect ? undefined : exercise.correctAnswer,
    };
  }

  async completeLesson(userId: string, lessonId: string): Promise<UserProgressDto> {
    const attempts = await this.attemptRepo.find({
      where: { userId, exercise: { lessonId } },
      relations: ['exercise'],
    });

    const correctCount = attempts.filter(a => a.isCorrect).length;
    const totalExercises = await this.exerciseRepo.count({ where: { lessonId } });
    const score = (correctCount / totalExercises) * 100;

    await this.progressRepo.update(
      { userId, lessonId },
      { status: 'completed', score, completedAt: new Date() },
    );

    return this.getLessonProgress(userId, lessonId);
  }
}
```

### Step 5: Create Pagination Helper (30min)

```typescript
// src/common/dto/pagination.dto.ts
export class PaginationQueryDto {
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PaginatedResponseDto<T> {
  @ApiProperty()
  items: T[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
```

### Step 6: Register Modules in AppModule (15min)

```typescript
// src/app.module.ts
@Module({
  imports: [
    // ... existing imports
    UserModule,
    LanguageModule,
    LessonModule,
    ProgressModule,
  ],
})
export class AppModule {}
```

## Todo List

### User Module
- [ ] Create UserModule
- [ ] Create UserController (GET/PATCH/DELETE /users/me)
- [ ] Create UserService
- [ ] Create UserProfileDto
- [ ] Create UpdateUserDto

### Language Module
- [ ] Create LanguageModule
- [ ] Create LanguageController
- [ ] Create LanguageService
- [ ] Create LanguageDto
- [ ] Create UserLanguageDto
- [ ] Create AddUserLanguageDto

### Lesson Module
- [ ] Create LessonModule
- [ ] Create LessonController with pagination
- [ ] Create LessonService
- [ ] Create LessonDto
- [ ] Create LessonDetailDto
- [ ] Create ExerciseDto

### Progress Module
- [ ] Create ProgressModule
- [ ] Create ProgressController
- [ ] Create ProgressService
- [ ] Create UserProgressDto
- [ ] Create SubmitExerciseDto
- [ ] Create ExerciseResultDto
- [ ] Implement answer checking logic

### Common
- [ ] Create PaginationQueryDto
- [ ] Create PaginatedResponseDto
- [ ] Register all modules in AppModule
- [ ] Write unit tests for services
- [ ] Write e2e tests for controllers

## Success Criteria

- [x] GET /users/me returns user profile
- [x] PATCH /users/me updates profile
- [x] GET /languages returns active languages
- [x] GET /languages/user returns user's learning languages
- [x] POST /languages/user adds language
- [x] GET /lessons?languageId=X returns paginated lessons
- [x] GET /lessons/:id returns lesson with exercises
- [x] GET /progress returns user progress
- [x] POST /progress/exercises/:id/submit records attempt
- [x] POST /progress/lessons/:id/complete calculates score
- [x] All endpoints have Swagger documentation

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Complex exercise types | Medium | Low | Start with simple types, extend later |
| N+1 query issues | Medium | Medium | Use TypeORM relations, eager loading |
| Score calculation edge cases | Low | Low | Handle zero exercises case |

## Security Considerations

- Users can only access their own progress data
- RLS policies enforce data isolation
- Exercise answers validated server-side
- No direct DB access, only through services
