# Phase 1: Update DTO and Controller

## Context
- [translate-request.dto.ts](../../src/modules/ai/dto/translate-request.dto.ts)
- [ai.controller.ts](../../src/modules/ai/ai.controller.ts)
- [public-route.decorator.ts](../../src/common/decorators/public-route.decorator.ts)
- [jwt-auth.guard.ts](../../src/modules/auth/guards/jwt-auth.guard.ts)

## Overview
- **Priority:** P1
- **Status:** pending
- Make `/ai/translate` accept both authenticated and anonymous requests

## Key Insights
- `@Public()` skips JWT guard entirely -- `request.user` is `undefined` for anonymous
- Need optional JWT extraction: use `@Public()` + manually attempt passport auth
- Simplest approach: `@Public()` on endpoint, then use `@Req()` to check `request.user`
- NestJS pattern for optional auth: override `handleRequest` in guard to not throw, OR use a dedicated `OptionalJwtGuard`

## Architecture

**Recommended approach: `OptionalJwtAuthGuard`**
- Create a new guard that runs JWT validation but does NOT throw on failure -- just sets `request.user = null`
- Apply this guard to the translate endpoint instead of relying on global guard
- This is cleaner than `@Public()` because the global guard already skips public routes

**Alternative (simpler, preferred): Modify `@Public()` + manual extraction**
- Mark endpoint `@Public()` so global guard skips it
- In controller, use `@Req() req` and manually try `req.user` (will be populated if JWT was sent and valid via passport)
- Problem: with `@Public()`, passport never runs, so `req.user` is always undefined

**Final approach: Use `@Public()` + inject `JwtService` in controller to manually decode**
- Too coupled. Not ideal.

**BEST approach: Create `OptionalAuth` decorator + guard**

## Related Code Files

### Modify
- `src/modules/ai/dto/translate-request.dto.ts` -- add optional `sessionToken`
- `src/modules/ai/ai.controller.ts` -- update translate endpoint signature
- `src/modules/auth/guards/jwt-auth.guard.ts` -- add optional auth support

### Create
- `src/common/decorators/optional-auth.decorator.ts` -- new decorator for optional JWT

## Implementation Steps

### Step 1: Create OptionalAuth decorator and guard logic
Create `src/common/decorators/optional-auth.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';
export const OptionalAuth = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
```

### Step 2: Update JwtAuthGuard to handle optional auth
In `jwt-auth.guard.ts`, add handling for `IS_OPTIONAL_AUTH_KEY`:
- If `isOptionalAuth` is true: call `super.canActivate()` but catch errors and allow through
- Override `handleRequest()` to not throw when `isOptionalAuth` and no user found

```typescript
// In canActivate:
const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [...]);
if (isOptionalAuth) {
  try {
    await super.canActivate(context);
  } catch {
    // JWT missing/invalid -- allow through, user will be null
  }
  return true;
}

// Override handleRequest:
handleRequest(err, user, info, context) {
  const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [...]);
  if (isOptionalAuth && !user) {
    return null; // Don't throw, just return null
  }
  if (err || !user) {
    throw err || new UnauthorizedException();
  }
  return user;
}
```

### Step 3: Update TranslateRequestDto
Add optional `sessionToken` field with conditional validation:
```typescript
@ApiPropertyOptional({ description: 'Session token for anonymous users (onboarding)' })
@IsOptional()
@IsString()
sessionToken?: string;
```
No need for conditional validation -- service layer will validate presence based on auth context.

### Step 4: Update AiController.translate endpoint
Replace `@CurrentUser() user: User` with optional user extraction:
```typescript
@Post('translate')
@OptionalAuth()  // <-- replaces implicit global JWT requirement
@ApiOperation({ summary: 'Translate a word or sentence' })
async translate(@Req() req: Request, @Body() dto: TranslateRequestDto) {
  const user = req.user as User | null;

  if (dto.type === TranslateType.WORD) {
    return this.translationService.translateWord(
      dto.text!, dto.sourceLang, dto.targetLang,
      user?.id ?? null, dto.sessionToken,
    );
  }
  return this.translationService.translateSentence(
    dto.messageId!, dto.sourceLang, dto.targetLang,
    user?.id ?? null, dto.sessionToken,
  );
}
```

Validation logic (in service, not controller -- keeps controller thin):
- If no `user` AND no `sessionToken`: throw `BadRequestException`
- If `user` exists: use authenticated path
- If `sessionToken` only: use anonymous path

## Todo List
- [ ] Create `optional-auth.decorator.ts`
- [ ] Update `jwt-auth.guard.ts` with optional auth handling
- [ ] Add `sessionToken` to `TranslateRequestDto`
- [ ] Update `AiController.translate` to use `@OptionalAuth()` + `@Req()`
- [ ] Update Swagger docs (remove `@ApiBearerAuth` for this endpoint or mark as optional)
- [ ] Verify existing authenticated flow still works

## Success Criteria
- Authenticated users can call `/ai/translate` with JWT (unchanged behavior)
- Anonymous users can call `/ai/translate` with `sessionToken` (no JWT)
- Request without JWT AND without sessionToken returns 400
- Swagger docs reflect optional auth

## Risk
- Must ensure `handleRequest` override doesn't break other endpoints using global guard
- The `isOptionalAuth` check in `handleRequest` needs access to `Reflector` + `ExecutionContext`; `handleRequest` doesn't receive context directly -- need to store it during `canActivate`
