# API Response Serialization Setup Exploration

**Date:** 2026-03-29  
**Objective:** Understand current API response serialization setup to plan snake_case serialization implementation

---

## 1. Current Response Serialization Architecture

### Main Entry Point: `src/main.ts`
- **Global Validation Pipe**: Configured with `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`
- **Global Response Interceptor**: `ResponseTransformInterceptor` applied globally
- **Global Exception Filter**: `AllExceptionsFilter` for error handling
- **CORS**: Enabled with configurable origins

**Key Detail**: The global `ResponseTransformInterceptor` wraps all responses in `BaseResponseDto`.

### Response Interceptor: `src/common/interceptors/response-transform.interceptor.ts`
```typescript
- Intercepts all responses
- Checks if response is already BaseResponseDto instance
- If not, wraps data with BaseResponseDto.success(data)
- Currently performs NO serialization transformation
```

**Current State**: Plain object serialization — properties are returned as-is (camelCase).

### Base Response DTO: `src/common/dto/base-response.dto.ts`
```typescript
export class BaseResponseDto<T> {
  @ApiProperty({ example: 1, description: '1 for success, 0 for error' })
  code: number;

  @ApiProperty({ example: 'Success', description: 'Response message' })
  message: string;

  @ApiProperty({ description: 'Response payload' })
  data: T | null;

  static success<T>(data: T, message = 'Success'): BaseResponseDto<T>
  static error<T>(message: string, data: T | null = null): BaseResponseDto<T>
}
```

**Critical Point**: No `@Expose` or `@Transform` decorators. Wrapper itself has only 3 simple properties (`code`, `message`, `data`).

---

## 2. Dependencies Analysis

### Relevant Versions (from `package.json`):
```
"class-transformer": "^0.5.1"
"class-validator": "^0.14.1"
```

**Status**: Both libraries are installed. `class-transformer` is at version 0.5.1, which fully supports:
- `@Expose()` decorator
- `@Transform()` decorator
- `classToPlain()` / `classToInstance()` functions
- `toPlainOnly` / `toClassOnly` options

---

## 3. DTO Inventory & Current State

### Total DTOs: 26 files across 7 modules

#### Auth Module (8 DTOs)
- `auth-response.dto.ts` → Response wrapper
- `login.dto.ts` → Input request DTO
- `register.dto.ts` → Input request DTO
- `verify-otp.dto.ts` → Input request DTO
- `forgot-password.dto.ts` → Input request DTO
- `reset-password.dto.ts` → Input request DTO
- `google-auth.dto.ts` → Input request DTO
- `apple-auth.dto.ts` → Input request DTO
- `refresh-token.dto.ts` → Input request DTO

#### User Module (2 DTOs)
- `user-profile.dto.ts` → Response DTO (nested in auth responses)
- `update-user.dto.ts` → Input request DTO

#### Language Module (6 DTOs)
- `language.dto.ts` → Response DTO
- `user-language.dto.ts` → Response DTO
- `language-query.dto.ts` → Input request DTO
- `add-user-language.dto.ts` → Input request DTO
- `update-user-language.dto.ts` → Input request DTO
- `set-native-language.dto.ts` → Input request DTO

#### AI Module (3 DTOs)
- `chat.dto.ts` → Contains `ChatRequestDto` (input) & `ChatResponseDto` (response)
  - Also has `ConversationContext` nested DTO
- `correction-check.dto.ts` → Contains `CorrectionCheckRequestDto` & `CorrectionCheckResponseDto`
- `translate-request.dto.ts` → Input request DTO

#### Subscription Module (2 DTOs)
- `subscription.dto.ts` → Response DTO
- `revenuecat-webhook.dto.ts` → Webhook input DTO

#### Onboarding Module (4 DTOs)
- `start-onboarding.dto.ts` → Input request DTO
- `onboarding-chat.dto.ts` → Contains input & response DTOs
- `onboarding-complete.dto.ts` → Input request DTO
- `onboarding-scenario.dto.ts` → Input request DTO

### Key DTO Pattern Observations

**No Decorators Currently Used**:
- Zero `@Expose()` decorators found
- Zero `@Transform()` decorators found
- No `@SerializeOptions()` usage
- No `classToPlain()`, `plainToClass()`, or similar transformations in code

**Example Response DTOs** (representative):
```typescript
// src/modules/auth/dto/auth-response.dto.ts
export class UserResponseDto {
  @ApiProperty()
  id!: string;
  
  @ApiProperty()
  email!: string;
  
  @ApiProperty({ required: false })
  displayName?: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;
  
  @ApiProperty()
  refreshToken!: string;
  
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
```

All properties follow camelCase convention. No transformation decorators.

---

## 4. Property Naming Convention Analysis

### Current Pattern: camelCase
All DTO properties use camelCase:
- `displayName` (not `display_name`)
- `avatarUrl` (not `avatar_url`)
- `nativeLanguageId` (not `native_language_id`)
- `accessToken` (not `access_token`)
- `refreshToken` (not `refresh_token`)
- `isNativeAvailable` (not `is_native_available`)
- `cancelAtPeriodEnd` (not `cancel_at_period_end`)
- `conversationId` (not `conversation_id`)
- `targetLanguage` (not `target_language`)
- `nativeLanguage` (not `native_language`)
- `proficiencyLevel` (not `proficiency_level`)
- `lessonTopic` (not `lesson_topic`)

**Database Entities** likely use snake_case (TypeORM convention), but DTOs present camelCase to API consumers.

---

## 5. TypeScript Configuration

### `tsconfig.json` Settings Relevant to Serialization:
```json
{
  "emitDecoratorMetadata": true,    // Required for class-transformer
  "experimentalDecorators": true,    // Required for @Expose/@Transform
  "target": "ES2022",
  "module": "commonjs",
  "strict": true
}
```

**Status**: Compiler is correctly configured for decorator support.

---

## 6. Current Serialization Flow

```
API Handler Returns DTO Instance or Plain Object
         ↓
ResponseTransformInterceptor.intercept()
         ↓
Check if BaseResponseDto instance?
         ├─ YES: Return as-is
         └─ NO: Wrap with BaseResponseDto.success(data)
         ↓
Plain JSON Response (camelCase properties preserved)
```

**No explicit serialization** is performed currently. Objects are serialized to JSON as-is via Express/NestJS default JSON serialization.

---

## 7. Nested DTO Structure

### Deep Nesting Examples Found:
1. **AuthResponseDto** → UserResponseDto (flat, 2 levels)
2. **ChatRequestDto** → ConversationContext (flat, 2 levels)
3. **BaseResponseDto<T>** → Generic T (could be any DTO)

**Implication**: Any snake_case transformation must be **recursive** to handle nested DTOs automatically.

---

## 8. Module Structure

```
src/modules/
├── auth/
│   ├── dto/
│   ├── guards/
│   ├── strategies/
│   └── decorators/
├── user/
│   └── dto/
├── language/
│   └── dto/
├── ai/
│   ├── dto/
│   ├── providers/
│   ├── services/
│   └── prompts/
├── subscription/
│   ├── dto/
│   └── webhooks/
├── onboarding/
│   └── dto/
└── email/
```

All response DTOs are in `dto/` subdirectories. No scattered response classes.

---

## 9. What Needs to Change for snake_case Serialization

### Option A: Interceptor-Level Transformation (Recommended)
**Modify**: `src/common/interceptors/response-transform.interceptor.ts`

1. Import `classToPlain()` from `class-transformer`
2. After wrapping response in BaseResponseDto:
   - Transform to plain object with `classToPlain(data, { excludeExtraneousValues: false })`
   - Use `classNameMap` or post-process to convert camelCase → snake_case recursively

**Pros**: 
- Single point of change
- Works for all DTOs automatically
- No need to modify individual DTOs

**Cons**:
- Object property names change after transformation (needs recursive string key conversion)

### Option B: DTO Decorator Approach (More Transparent)
**Modify**: All 26 DTO files

1. Add `@Expose()` with `name: 'snake_case'` to each property
2. Example:
```typescript
export class UserResponseDto {
  @ApiProperty()
  @Expose({ name: 'id' })
  id!: string;
  
  @ApiProperty()
  @Expose({ name: 'email' })
  email!: string;
  
  @ApiProperty()
  @Expose({ name: 'display_name' })
  displayName?: string;
}
```

3. Modify ResponseTransformInterceptor to use `classToPlain(data, { strategy: 'excludeAll' })`

**Pros**:
- Explicit mapping visible in DTOs
- Swagger docs can be updated to show snake_case
- Type-safe mapping

**Cons**:
- Tedious: 26 files × 100+ properties = 100+ decorators to add
- Maintenance burden: every new DTO needs decorators

### Option C: Global Serialization Rules (Best Practice)
**Create**: `src/common/serializers/snake-case.serializer.ts`

```typescript
export function camelToSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => camelToSnakeCase(item));
  }
  
  const converted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeCaseKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    converted[snakeCaseKey] = camelToSnakeCase(value);
  }
  return converted;
}
```

**Usage in ResponseTransformInterceptor**:
```typescript
map((data: T) => {
  if (data instanceof BaseResponseDto) {
    return camelToSnakeCase(data);
  }
  const response = BaseResponseDto.success(data);
  return camelToSnakeCase(response);
})
```

**Pros**:
- Single transformation logic
- Handles all cases (nested, arrays, etc.)
- No DTO changes needed
- Easy to test

**Cons**:
- Swagger docs still show camelCase (need separate handling)

---

## 10. Impact Analysis

### Files That Will Need Changes:
**Minimum (Option A/C):**
1. `src/common/interceptors/response-transform.interceptor.ts` (1 file)
2. Optionally: Create `src/common/serializers/snake-case.serializer.ts` (1 new file)

**Maximum (Option B):**
1. All 26 DTO files
2. `src/common/interceptors/response-transform.interceptor.ts`

### Testing Implications:
- Response format tests will need updates
- Integration tests will see snake_case in HTTP responses
- Frontend clients expecting camelCase will break (intended change)

### Breaking Changes:
- **YES** - All API responses will change from camelCase to snake_case
- Requires frontend update
- Affects API documentation/Swagger

---

## 11. Unresolved Questions

1. **Should input DTOs also use snake_case decorators?** (for Swagger docs clarity)
   - Current: Only response DTOs need snake_case serialization
   - Input DTOs: NestJS still expects camelCase in request bodies (automatic transformation)

2. **How to handle Swagger documentation?**
   - Option B makes it automatic via decorators
   - Options A/C require separate Swagger schema customization

3. **Are there any API clients/SDKs consuming this?**
   - Need to know if breaking change can be made
   - Version bump recommended if yes

4. **Should webhook payloads (subscription) also use snake_case?**
   - `revenuecat-webhook.dto.ts` is input, not output
   - External service format typically dictates structure

5. **Date/Time serialization strategy?**
   - Current: Dates are plain Date objects in DTOs
   - snake_case conversion won't affect Date serialization
   - May want ISO string conversion globally

---

## 12. Summary

### Current State
- **26 DTOs** across 7 modules, all using camelCase
- **No serialization decorators** currently in use
- **class-transformer v0.5.1** is installed and ready
- **Single global ResponseTransformInterceptor** controls all response transformation
- **No explicit JSON transformation** — objects serialized as-is

### Recommended Approach
**Option C (Global Serializer)** offers the best balance:
- Single source of truth for transformation logic
- No changes to 26 DTO files
- Works recursively for nested objects
- Only requires 2 file changes (1 modification, 1 new file)

### Implementation Path
1. Create `src/common/serializers/snake-case.serializer.ts` with recursive conversion logic
2. Modify `src/common/interceptors/response-transform.interceptor.ts` to use serializer
3. Write unit tests for edge cases (null, undefined, arrays, nested objects)
4. Update API documentation/migration guide for clients

### Effort Estimate
- **Implementation**: 2-3 hours
- **Testing**: 2-3 hours
- **Documentation/Migration**: 1-2 hours
