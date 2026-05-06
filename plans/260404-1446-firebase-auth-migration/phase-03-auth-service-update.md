---
phase: 3
title: "Unified Endpoint + Service + DTO"
status: completed
priority: high
effort: 45m
completed: 2026-04-04
---

# Phase 3: Unified Endpoint + Service + DTO

## Context Links
- [Plan overview](plan.md)
- [Auth service](../../src/modules/auth/auth.service.ts)
- [Auth controller](../../src/modules/auth/auth.controller.ts)
- [Auth module](../../src/modules/auth/auth.module.ts)
- [Google DTO](../../src/modules/auth/dto/google-auth.dto.ts)
- [Apple DTO](../../src/modules/auth/dto/apple-auth.dto.ts)

## Overview

Replace `POST /auth/google` + `POST /auth/apple` with single `POST /auth/firebase`. Create unified DTO, single service method, single controller endpoint. Provider detection is automatic from Firebase token.

## Key Insights

- `FirebaseTokenStrategy.validate()` already returns `provider: 'google' | 'apple'` from decoded token
- No need for caller to specify provider — Firebase token contains this info
- `oauthLogin()` private method stays unchanged — it already accepts `OAuthProvider`
- DTOs for Google and Apple are nearly identical — merge into one `FirebaseAuthDto`

## Requirements

- Single `POST /auth/firebase` endpoint accepting `{ idToken, displayName?, conversationId? }`
- Single `firebaseLogin()` service method replacing `googleLogin()` + `appleLogin()`
- Provider auto-detected from Firebase token
- Remove old Google/Apple endpoints and methods
- Wire `FirebaseAdminService` + `FirebaseTokenStrategy` into `AuthModule`

## Related Code Files

**Create:**
- `src/modules/auth/dto/firebase-auth.dto.ts`

**Modify:**
- `src/modules/auth/auth.controller.ts` — replace 2 endpoints with 1
- `src/modules/auth/auth.service.ts` — replace 2 methods with 1, update constructor
- `src/modules/auth/auth.module.ts` — swap providers
- `src/modules/auth/dto/index.ts` — export new DTO, remove old exports

**Delete (in Phase 4):**
- `src/modules/auth/dto/google-auth.dto.ts`
- `src/modules/auth/dto/apple-auth.dto.ts`

## Implementation Steps

### 1. Create `firebase-auth.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

export class FirebaseAuthDto {
  @ApiProperty({ description: 'Firebase ID token from Firebase Auth SDK' })
  @IsString()
  idToken!: string;

  @ApiProperty({ required: false, description: 'User display name' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ required: false, description: 'Onboarding conversation ID to link' })
  @IsUUID()
  @IsOptional()
  conversationId?: string;
}
```

### 2. Update `dto/index.ts`

```typescript
// Remove: export * from './google-auth.dto';
// Remove: export * from './apple-auth.dto';
// Add:
export * from './firebase-auth.dto';
```

### 3. Update `auth.module.ts`

```typescript
// Remove: AppleStrategy, GoogleIdTokenStrategy imports + providers
// Add: FirebaseAdminService, FirebaseTokenStrategy imports + providers
providers: [AuthService, JwtStrategy, FirebaseAdminService, FirebaseTokenStrategy],
```

### 4. Update `auth.service.ts`

Replace constructor injections and add single method:

```typescript
// Constructor: remove appleStrategy + googleIdTokenStrategy, add firebaseTokenStrategy

async firebaseLogin(
  idToken: string,
  displayName?: string,
  conversationId?: string,
): Promise<AuthResponseDto> {
  const firebaseUser = await this.firebaseTokenStrategy.validate(idToken);
  const providerUser: OAuthProviderUser = {
    email: firebaseUser.email,
    providerId: firebaseUser.providerId,
    displayName: displayName ?? firebaseUser.displayName,
    avatarUrl: firebaseUser.avatarUrl,
  };
  return this.oauthLogin(firebaseUser.provider, providerUser, conversationId);
}
```

Remove `googleLogin()` and `appleLogin()` methods entirely.

### 5. Update `auth.controller.ts`

Replace two endpoints with one:

```typescript
@Public()
@Post('firebase')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Sign in with Firebase (Google or Apple)' })
@ApiResponse({ status: 200, type: AuthResponseDto })
@ApiResponse({ status: 401, description: 'Invalid Firebase ID token' })
async firebaseAuth(@Body() dto: FirebaseAuthDto): Promise<AuthResponseDto> {
  return this.authService.firebaseLogin(dto.idToken, dto.displayName, dto.conversationId);
}
```

Remove `googleAuth()` and `appleAuth()` methods entirely.

### 6. Verify unchanged code

Must NOT change:
- `oauthLogin()`, `register()`, `login()`, `refreshTokens()`, `logout()`
- `forgotPassword()`, `verifyOtp()`, `resetPassword()`
- JWT strategy, guards, decorators

## Todo List

- [ ] Create `firebase-auth.dto.ts`
- [ ] Update `dto/index.ts`
- [ ] Update `auth.module.ts` providers
- [ ] Update `auth.service.ts` — single `firebaseLogin()`, remove old methods
- [ ] Update `auth.controller.ts` — single `POST /auth/firebase`, remove old endpoints
- [ ] Verify build: `npm run build`

## Success Criteria

- Single `POST /auth/firebase` endpoint works for both Google and Apple
- Provider auto-detected from token — caller doesn't specify
- All other auth endpoints unaffected
- Build passes
