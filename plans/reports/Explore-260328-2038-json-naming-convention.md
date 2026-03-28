# NestJS Backend JSON Response Key Format - Exploration Report

**Date:** 2026-03-28
**Project:** Flowering Backend
**Scope:** Understanding current JSON response key naming conventions and impact of camelCase → snake_case migration

---

## Executive Summary

The Flowering backend uses **camelCase** exclusively for all JSON response keys. The codebase uses:
- **TypeORM entities** with snake_case column definitions (`@Column({ name: 'column_name' })`)
- **DTOs** with camelCase property names (no explicit @Expose/@Transform decorators)
- **No ClassSerializerInterceptor** - using a custom ResponseTransformInterceptor
- **Minimal class-transformer usage** - only `@Type()` for nested DTO validation in 2 DTOs

A migration to snake_case would require changes across **28 DTO files** and all **15 entity files**, plus the response serialization logic.

---

## 1. Current Naming Convention

### DTOs: **camelCase** (universally)
All DTOs use camelCase property names with no snake_case alternatives:
- `displayName`, `avatarUrl`, `nativeLanguageId`
- `conversationId`, `targetLanguage`, `proficiencyLevel`
- `refreshToken`, `resetToken`, `sessionToken`
- `sourceLanguage`, `targetLanguage`
- `cancelAtPeriodEnd`, `expiresAt`, `createdAt`, `updatedAt`

### Entities: **snake_case** (in database)
All TypeORM entities use explicit `@Column({ name: 'snake_case' })` decorators:
- `@Column({ type: 'varchar', length: 100, name: 'display_name' })`
- `@Column({ type: 'uuid', name: 'native_language_id' })`
- `@Column({ type: 'boolean', name: 'is_active' })`
- `@Column({ name: 'created_at' })`
- `@Column({ name: 'updated_at' })`

The property names in entities remain **camelCase** (e.g., `displayName`, `nativeLanguageId`, `isActive`), while database columns are snake_case.

---

## 2. Current Serialization Architecture

### ResponseTransformInterceptor
**Location:** `/src/common/interceptors/response-transform.interceptor.ts`

```typescript
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, BaseResponseDto<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<BaseResponseDto<T>> {
    return next.handle().pipe(
      map((data: T) => {
        if (data instanceof BaseResponseDto) {
          return data;
        }
        return BaseResponseDto.success(data);
      }),
    );
  }
}
```

**Observations:**
- No class-transformer decorators used
- No `plainToInstance()` or `classToPlain()` calls
- Simply wraps response data in `BaseResponseDto<T>`
- Does NOT perform any property name transformation

### BaseResponseDto
**Location:** `/src/common/dto/base-response.dto.ts`

```typescript
export class BaseResponseDto<T> {
  @ApiProperty({ example: 1, description: '1 for success, 0 for error' })
  code: number;

  @ApiProperty({ example: 'Success', description: 'Response message' })
  message: string;

  @ApiProperty({ description: 'Response payload' })
  data: T | null;
}
```

**Key point:** Wrapper only, no serialization logic.

### Global Pipes & Configuration
**Location:** `/src/main.ts`

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }),
);
```

- `ValidationPipe` with `transform: true` handles request DTO transformation
- No `ClassSerializerInterceptor` registered globally
- No ClassSerializerInterceptor anywhere in the codebase

---

## 3. class-transformer Usage

**Version:** `^0.5.1` (from package.json)

**Usage found in codebase:**
1. **`/src/modules/ai/dto/chat.dto.ts`** - Uses `@Type(() => ConversationContext)` for nested DTO validation
2. **`/src/modules/subscription/dto/revenuecat-webhook.dto.ts`** - Uses `@Type(() => RevenueCatEventDto)` for nested DTO validation

**NOT found:**
- No `@Expose()` decorators
- No `@Transform()` decorators  
- No `@Exclude()` decorators
- No `plainToInstance()` calls
- No `classToPlain()` calls
- No `classToClassFromPlain()` calls

**Conclusion:** class-transformer is minimally used - only for type coercion of nested objects during request validation.

---

## 4. TypeORM Naming Strategy

**Files checked:**
- `/src/database/database.module.ts`
- `/src/database/typeorm-data-source.ts`

**Findings:**
- **NO custom naming strategy configured**
- TypeORM defaults used (no `namingStrategy` option in DataSource)
- All column names explicitly defined using `@Column({ name: 'snake_case' })`
- **Implicit conversion happens automatically:**
  - Database columns: `created_at`, `updated_at`, `password_hash`
  - Entity properties: `createdAt`, `updatedAt`, `passwordHash`

---

## 5. Complete File Inventory

### All DTO Files (28 total)

**Auth Module:**
- `/src/modules/auth/dto/login.dto.ts`
- `/src/modules/auth/dto/register.dto.ts`
- `/src/modules/auth/dto/auth-response.dto.ts`
- `/src/modules/auth/dto/google-auth.dto.ts`
- `/src/modules/auth/dto/apple-auth.dto.ts`
- `/src/modules/auth/dto/verify-otp.dto.ts`
- `/src/modules/auth/dto/forgot-password.dto.ts`
- `/src/modules/auth/dto/reset-password.dto.ts`
- `/src/modules/auth/dto/refresh-token.dto.ts`

**Language Module:**
- `/src/modules/language/dto/language.dto.ts`
- `/src/modules/language/dto/user-language.dto.ts`
- `/src/modules/language/dto/language-query.dto.ts`
- `/src/modules/language/dto/add-user-language.dto.ts`
- `/src/modules/language/dto/set-native-language.dto.ts`
- `/src/modules/language/dto/update-user-language.dto.ts`

**User Module:**
- `/src/modules/user/dto/user-profile.dto.ts`
- `/src/modules/user/dto/update-user.dto.ts`

**AI Module:**
- `/src/modules/ai/dto/chat.dto.ts`
- `/src/modules/ai/dto/correction-check.dto.ts`
- `/src/modules/ai/dto/translate-request.dto.ts`

**Subscription Module:**
- `/src/modules/subscription/dto/subscription.dto.ts`
- `/src/modules/subscription/dto/revenuecat-webhook.dto.ts`

**Onboarding Module:**
- `/src/modules/onboarding/dto/start-onboarding.dto.ts`
- `/src/modules/onboarding/dto/onboarding-chat.dto.ts`
- `/src/modules/onboarding/dto/onboarding-scenario.dto.ts`
- `/src/modules/onboarding/dto/onboarding-complete.dto.ts`

**Common:**
- `/src/common/dto/base-response.dto.ts`

### All Entity Files (15 total)

- `/src/database/entities/user.entity.ts`
- `/src/database/entities/language.entity.ts`
- `/src/database/entities/user-language.entity.ts`
- `/src/database/entities/lesson.entity.ts`
- `/src/database/entities/exercise.entity.ts`
- `/src/database/entities/user-progress.entity.ts`
- `/src/database/entities/user-exercise-attempt.entity.ts`
- `/src/database/entities/subscription.entity.ts`
- `/src/database/entities/ai-conversation.entity.ts`
- `/src/database/entities/ai-conversation-message.entity.ts`
- `/src/database/entities/device-token.entity.ts`
- `/src/database/entities/refresh-token.entity.ts`
- `/src/database/entities/password-reset.entity.ts`
- `/src/database/entities/vocabulary.entity.ts`
- `/src/database/entities/webhook-event.entity.ts`

---

## 6. Swagger/ApiProperty Decorators

**Findings:**
- All DTOs use `@ApiProperty()` and `@ApiPropertyOptional()`
- **NO explicit `name` field used in any @ApiProperty decorator**
  - Swagger will infer property names from the actual property names (camelCase)
  - Changing to snake_case would require updating all @ApiProperty decorators to specify `name: 'snake_case'` for accurate documentation

**Example from DTOs:**
```typescript
@ApiProperty({ description: 'User ID' })
id!: string;

@ApiProperty({ description: 'Display name' })
displayName?: string;  // Will show as 'displayName' in Swagger, not 'display_name'
```

---

## 7. RevenueCat Webhook Special Case

**File:** `/src/modules/subscription/dto/revenuecat-webhook.dto.ts`

This DTO **ALREADY uses snake_case** properties because it mirrors RevenueCat's external API format:
```typescript
@ApiProperty({ description: 'App user ID (our user ID)' })
@IsString()
@MaxLength(255)
app_user_id!: string;  // ← snake_case from external API

@ApiProperty({ description: 'Original app user ID' })
@IsString()
@MaxLength(255)
original_app_user_id!: string;  // ← snake_case from external API

@ApiProperty({ description: 'Product ID from store' })
@IsString()
@MaxLength(255)
product_id!: string;  // ← snake_case from external API

@ApiProperty({ description: 'Expiration timestamp in ms' })
@IsOptional()
@IsNumber()
expiration_at_ms?: number;  // ← snake_case from external API

@ApiProperty({ description: 'Purchase timestamp in ms' })
@IsOptional()
@IsNumber()
purchased_at_ms?: number;  // ← snake_case from external API

@ApiProperty({ description: 'API version' })
@IsString()
@MaxLength(20)
api_version!: string;  // ← snake_case from external API
```

**Note:** This is **explicitly designed** to match external API format and should be kept as-is.

---

## 8. Impact Assessment: camelCase → snake_case Migration

### Changes Required

#### A. DTOs (28 files)
**Action:** Rename all properties from camelCase to snake_case

Example transformation:
```typescript
// Before
displayName?: string;
avatarUrl?: string;
nativeLanguageId?: string;
createdAt!: Date;

// After
display_name?: string;
avatar_url?: string;
native_language_id?: string;
created_at!: Date;
```

#### B. Entities (15 files)
**Action:** Rename all property declarations (keep column definitions unchanged)

Example transformation:
```typescript
// Before
@Column({ type: 'varchar', length: 100, name: 'display_name', nullable: true })
displayName?: string;

// After
@Column({ type: 'varchar', length: 100, name: 'display_name', nullable: true })
display_name?: string;
```

**OR:** Use `@Expose('display_name')` from class-transformer if keeping camelCase in code (requires ResponseTransformInterceptor changes)

#### C. ResponseTransformInterceptor
**Current behavior:** Passes DTO objects as-is (property names unchanged)

**Required changes for snake_case:**
- Add `plainToInstance()` call with `exposeUnknownProperties: false`
- Or add `@Expose()` decorators to all DTO properties
- Example:
```typescript
import { plainToInstance } from 'class-transformer';

return next.handle().pipe(
  map((data: T) => {
    if (data instanceof BaseResponseDto) {
      return data;
    }
    // Transform to plain object with snake_case keys
    const plainData = plainToInstance(data.constructor, data, {
      excludeExtraneousValues: true,
      exposeUnknownProperties: false,
    });
    return BaseResponseDto.success(plainData);
  }),
);
```

#### D. Swagger Documentation
**Current:** @ApiProperty decorators don't specify property names, so Swagger shows camelCase

**Required changes:**
- Add explicit `name` fields to all @ApiProperty decorators OR
- Use the automatic mapping if class-transformer is properly configured

Example:
```typescript
@ApiProperty({ description: 'Display name', name: 'display_name' })
display_name?: string;
```

#### E. RevenueCat Webhook DTO
**Status:** NO CHANGES NEEDED
- Already uses snake_case to match external API
- Keep as-is to avoid mapping/unmapping complexity

### Files Requiring Changes Summary
- **28 DTO files** - property name changes
- **15 Entity files** - property name changes  
- **1 ResponseTransformInterceptor** - serialization logic
- **28 @ApiProperty decorators** (across all DTOs) - explicit name specifications (optional if auto-mapped)

**Total impact:** Approximately **43-50 files** affected (DTOs, entities, interceptor, tests if any)

---

## 9. Alternative Approaches

### Option 1: Use @Expose() with class-transformer (Recommended for minimal code changes)
```typescript
import { Expose } from 'class-transformer';

export class UserProfileDto {
  @Expose({ name: 'display_name' })
  displayName?: string;

  @Expose({ name: 'avatar_url' })
  avatarUrl?: string;
}
```

**Pros:**
- Keep camelCase in TypeScript code
- Automatic transformation in ResponseTransformInterceptor
- Works with existing validation pipes

**Cons:**
- Still need to update all DTOs (add @Expose to each property)
- More decorators = more boilerplate

### Option 2: Rename properties to snake_case (Current approach above)
```typescript
export class UserProfileDto {
  @ApiProperty({ description: 'Display name' })
  display_name?: string;

  @ApiProperty({ description: 'Avatar URL' })
  avatar_url?: string;
}
```

**Pros:**
- Matches database conventions exactly
- No @Expose decorators needed
- Simpler serialization logic

**Cons:**
- Non-idiomatic TypeScript naming
- All business logic must use snake_case properties
- IDE autocomplete shows snake_case (harder to work with)

### Option 3: Create separate response models (Not recommended)
Use separate response DTOs that only exist for API responses.

**Pros:** Maximum flexibility

**Cons:** Code duplication, maintenance burden

---

## 10. Key Findings Summary

| Aspect | Finding |
|--------|---------|
| **Current JSON keys** | camelCase (universally) |
| **Database columns** | snake_case (via @Column decorators) |
| **Entity properties** | camelCase |
| **class-transformer usage** | Minimal (@Type only, no @Expose/@Transform) |
| **ClassSerializerInterceptor** | NOT used |
| **Serialization** | Custom ResponseTransformInterceptor (no transformation) |
| **Swagger naming** | Inferred from property names (camelCase) |
| **Special cases** | RevenueCat webhook already uses snake_case |
| **Files to change** | 43-50 files (28 DTOs, 15 entities, interceptor, decorators) |

---

## 11. Unresolved Questions

- **Performance impact?** - Will `plainToInstance()` call in every response have measurable impact on API latency?
- **Backward compatibility?** - Are there client applications depending on camelCase that cannot be updated?
- **Database migration?** - Database columns are already snake_case, so no migrations needed there
- **Test coverage?** - Are there integration tests that verify response key formats?
- **External webhooks?** - Besides RevenueCat, are there other integrations expecting specific key formats?
- **API clients?** - What are the clients of this API (mobile apps, web frontend)? Will they need updates?

