# Code Review: Firebase Auth Migration

**Date:** 2026-04-04
**Reviewer:** code-reviewer
**Scope:** Firebase Auth migration — 9 files changed, 3 deleted

## Overall Assessment

Clean, well-structured migration. The unified `POST /auth/firebase` endpoint correctly consolidates Google + Apple flows. Backward compatibility with existing `google_provider_id`/`apple_provider_id` columns is handled properly. No dead references to old endpoints or DTOs remain in production code.

---

## Critical Issues

None found.

---

## High Priority

### H1. `idToken` DTO lacks `@IsNotEmpty()` validation

**File:** `src/modules/auth/dto/firebase-auth.dto.ts:6`

`@IsString()` alone accepts empty strings (`""`). An empty string will still reach `verifyIdToken()` and throw a Firebase SDK error that gets caught and re-thrown as a generic 401. While not exploitable, adding `@IsNotEmpty()` gives the caller a clear 400 with a descriptive message instead of a misleading 401.

```ts
// Suggested fix
import { IsString, IsOptional, IsUUID, IsNotEmpty } from 'class-validator';

@IsString()
@IsNotEmpty()
idToken!: string;
```

**Impact:** Poor DX / misleading error. Low severity but trivial fix.

### H2. `verifyIdToken` not called with `checkRevoked: true`

**File:** `src/modules/auth/strategies/firebase-token.strategy.ts:20`

```ts
const decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken);
```

Firebase's `verifyIdToken(token, true)` checks whether the token has been revoked (e.g., user disabled in Firebase Console, password changed, session revoked). Without it, a revoked token remains valid until its natural expiry (~1 hour). In a production app where admins might disable compromised accounts, this is a security gap.

```ts
// Suggested fix
const decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken, true);
```

**Impact:** Revoked Firebase tokens accepted for up to 1 hour. Trades one extra Firebase API call per auth request for the ability to immediately block compromised accounts.

**Trade-off:** Adds ~50ms latency per auth call. If this is unacceptable, document the decision explicitly.

---

## Medium Priority

### M1. Duplicate `OAuthProvider` type definition

`OAuthProvider` is defined in two places:
- `src/modules/auth/strategies/firebase-token.strategy.ts:4` — `export type OAuthProvider = 'google' | 'apple'`
- `src/modules/auth/auth.service.ts:28` — `type OAuthProvider = 'google' | 'apple'`

**Fix:** Remove the local definition in `auth.service.ts` and import from the strategy file:
```ts
import { FirebaseTokenStrategy, OAuthProvider } from './strategies/firebase-token.strategy';
```

### M2. `OAuthProviderUser` interface duplicates `FirebaseAuthUser` shape

`auth.service.ts:30-35` defines `OAuthProviderUser` with nearly the same shape as `FirebaseAuthUser` from the strategy. The mapping in `firebaseLogin()` just copies fields. Consider importing and using `FirebaseAuthUser` directly to reduce the surface area, or extract a shared interface.

### M3. `FirebaseAdminService` is scoped to `AuthModule` but lives in `common/services/`

The service is in `src/common/services/` (implying shared/global), but it is only provided in `AuthModule.providers`. This works fine today, but if another module (e.g., notifications already uses Firebase for push) needs `FirebaseAdminService`, they will get a separate instance or a missing-provider error.

**Options:**
1. Move to `auth/` since it is only used there.
2. Or register in a `FirebaseModule` with `@Global()` if push notifications will share it.

### M4. Race condition on auto-link (low probability)

In `oauthLogin()`, between the `findOne({ email })` check and the `update()`, a concurrent request could create a user with the same email. The `email` column has a unique constraint so the second request would get a DB error that propagates as a 500.

This is extremely unlikely (requires two first-time logins with the same email within milliseconds) but could be hardened with a try/catch around the update+create block that retries on unique constraint violation.

---

## Low Priority

### L1. `signInProvider` error message leaks internal value

```ts
throw new UnauthorizedException(`Unsupported sign-in provider: ${signInProvider}`);
```

This exposes the raw Firebase `sign_in_provider` string (e.g., `password`, `phone`, `anonymous`) to the client. Consider a generic message: `"Only Google and Apple sign-in are supported"`.

### L2. `admin.apps.length` check is defensive but fragile

The `!admin.apps.length` guard in `FirebaseAdminService.onModuleInit()` protects against double-init in tests, but `admin.apps` is an array that could have `undefined` entries after `deleteApp()`. This is fine for production but worth noting for test cleanup scenarios. The Firebase SDK handles this internally in recent versions (13.x), so this guard is adequate.

---

## Edge Cases Found by Scouting

1. **No dead references**: Grep confirms zero references to `auth/google`, `auth/apple`, `googleLogin`, `appleLogin`, `GoogleAuthDto`, `AppleAuthDto` in production code. Clean removal.
2. **Entity columns preserved**: `google_provider_id` and `apple_provider_id` columns remain on the User entity with their partial unique indexes. Backward compatibility intact.
3. **`.env.example` updated**: Firebase env vars are present.
4. **`firebase-admin` in `dependencies`**: Confirmed in `package.json`. No Railway build risk.
5. **`FirebaseAdminService` not in `database.module.ts`**: Correct -- it is not a TypeORM entity, no global registration needed.

---

## Positive Observations

- **Provider ID extraction** (`identities[signInProvider][0]`) correctly pulls the original Google/Apple sub rather than Firebase UID, maintaining backward compat with existing DB rows.
- **Fallback to `decoded.uid`** when identities array is missing is a safe defensive choice.
- **Error handling** properly re-throws `UnauthorizedException` while wrapping all other Firebase SDK errors generically -- no stack trace leakage.
- **`displayName` precedence**: Client-provided name takes priority over Firebase profile name. Good for Apple's "hide my email" users who may want a custom name.
- **49/49 tests passing** with proper provider column assertions.

---

## Recommended Actions

1. **[H2]** Add `checkRevoked: true` to `verifyIdToken()` -- or document the conscious trade-off.
2. **[H1]** Add `@IsNotEmpty()` to `idToken` field.
3. **[M1]** Remove duplicate `OAuthProvider` type.
4. **[L1]** Genericize the unsupported-provider error message.
5. **[M3]** Decide on `FirebaseAdminService` location based on whether notifications module will share it.

---

## Unresolved Questions

1. Will Firebase push notifications (currently using a separate Firebase setup?) be consolidated to use this `FirebaseAdminService`? If yes, M3 becomes higher priority.
2. Is the ~50ms latency cost of `checkRevoked: true` acceptable for this app's auth flow?
