---
phase: 3
title: "Update Auth Service + Module Wiring"
status: ready
priority: high
effort: 45m
---

# Phase 3: Update Auth Service + Module Wiring

## Context Links
- [Plan overview](plan.md)
- [Auth service](../../src/modules/auth/auth.service.ts) — `googleLogin()` line 106, `appleLogin()` line 121
- [Auth module](../../src/modules/auth/auth.module.ts) — providers line 35

## Overview

Wire `FirebaseAdminService` and `FirebaseTokenStrategy` into the auth module. Update `googleLogin()` and `appleLogin()` to use the single Firebase verifier instead of separate strategies.

## Key Insights

- `oauthLogin()` private method (line 139) stays completely unchanged — it already accepts `OAuthProvider` + `OAuthProviderUser`
- Only `googleLogin()` and `appleLogin()` change: replace strategy calls with `FirebaseTokenStrategy.validate()`
- Constructor injection changes: remove `AppleStrategy` + `GoogleIdTokenStrategy`, add `FirebaseTokenStrategy`

## Requirements

- Register `FirebaseAdminService` and `FirebaseTokenStrategy` as providers in `AuthModule`
- Remove `AppleStrategy` and `GoogleIdTokenStrategy` from providers
- Update `AuthService` constructor to inject `FirebaseTokenStrategy`
- Simplify `googleLogin()` and `appleLogin()` to use single strategy

## Related Code Files

**Modify:**
- `src/modules/auth/auth.module.ts` — swap providers
- `src/modules/auth/auth.service.ts` — update constructor + googleLogin/appleLogin methods

## Implementation Steps

### 1. Update `auth.module.ts`

```typescript
// Remove imports:
// - AppleStrategy
// - GoogleIdTokenStrategy

// Add imports:
import { FirebaseAdminService } from '../../common/services/firebase-admin.service';
import { FirebaseTokenStrategy } from './strategies/firebase-token.strategy';

// Update providers array:
providers: [AuthService, JwtStrategy, FirebaseAdminService, FirebaseTokenStrategy],
```

### 2. Update `auth.service.ts`

**Constructor** — replace two strategy injections with one:
```typescript
// Remove:
private appleStrategy: AppleStrategy,
private googleIdTokenStrategy: GoogleIdTokenStrategy,

// Add:
private firebaseTokenStrategy: FirebaseTokenStrategy,
```

**`googleLogin()` method** — simplify:
```typescript
async googleLogin(
  idToken: string,
  displayName?: string,
  conversationId?: string,
): Promise<AuthResponseDto> {
  const firebaseUser = await this.firebaseTokenStrategy.validate(idToken);
  if (firebaseUser.provider !== 'google') {
    throw new UnauthorizedException('Expected Google sign-in token');
  }
  const providerUser: OAuthProviderUser = {
    email: firebaseUser.email,
    providerId: firebaseUser.providerId,
    displayName: displayName ?? firebaseUser.displayName,
    avatarUrl: firebaseUser.avatarUrl,
  };
  return this.oauthLogin('google', providerUser, conversationId);
}
```

**`appleLogin()` method** — simplify:
```typescript
async appleLogin(
  idToken: string,
  displayName?: string,
  conversationId?: string,
): Promise<AuthResponseDto> {
  const firebaseUser = await this.firebaseTokenStrategy.validate(idToken);
  if (firebaseUser.provider !== 'apple') {
    throw new UnauthorizedException('Expected Apple sign-in token');
  }
  const providerUser: OAuthProviderUser = {
    email: firebaseUser.email,
    providerId: firebaseUser.providerId,
    displayName: displayName ?? firebaseUser.displayName,
  };
  return this.oauthLogin('apple', providerUser, conversationId);
}
```

**Remove imports:**
```typescript
// Remove:
import { AppleStrategy } from './strategies/apple.strategy';
import { GoogleIdTokenStrategy } from './strategies/google-id-token-validator.strategy';

// Add:
import { FirebaseTokenStrategy } from './strategies/firebase-token.strategy';
```

### 3. Verify unchanged code

These must NOT change:
- `oauthLogin()` — unchanged
- `register()`, `login()` — unchanged
- `refreshTokens()`, `logout()` — unchanged
- `forgotPassword()`, `verifyOtp()`, `resetPassword()` — unchanged
- Controller endpoints and DTOs — unchanged

## Todo List

- [ ] Update `auth.module.ts` providers
- [ ] Update `auth.service.ts` constructor
- [ ] Update `googleLogin()` method
- [ ] Update `appleLogin()` method
- [ ] Remove old strategy imports
- [ ] Verify build: `npm run build`

## Success Criteria

- Auth module compiles with new providers
- `POST /auth/google` and `POST /auth/apple` use Firebase verification
- All other auth endpoints completely unaffected
- Build passes

## Security Considerations

- Provider check (`firebaseUser.provider !== 'google'`) prevents a Google token from being used at the Apple endpoint and vice versa
- Email verification still enforced via Firebase strategy
