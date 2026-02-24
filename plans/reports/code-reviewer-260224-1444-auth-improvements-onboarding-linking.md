# Code Review: Auth Improvements + Onboarding Linking

**Date:** 2026-02-24
**Branch:** feat/auth-improvements-onboarding-linking
**Plan:** plans/260224-1344-auth-improvements-onboarding-linking/plan.md
**Overall Rating: 8.5/10**

---

## Code Review Summary

### Scope
- Files reviewed: 6 source files + 1 test spec + 1 entity + config
- Lines of code analyzed: ~450 (source) + ~570 (tests)
- Review focus: Auth module changes per plan

### Overall Assessment

Solid implementation. The three core problems (O(n) token scan, mobile Google OAuth, email conflict) are all solved cleanly. Code is readable, well-structured, and all 53 tests pass. Build is clean. One high-priority issue with the RefreshToken PK strategy, a few medium concerns.

---

### Critical Issues

None.

---

### High Priority Findings

#### H1: RefreshToken PK — `PrimaryGeneratedColumn` vs. explicit `id` set in code

**File:** `src/database/entities/refresh-token.entity.ts` line 14, `src/modules/auth/auth.service.ts` line 233

The entity declares `@PrimaryGeneratedColumn('uuid')` but `generateTokens()` passes `id: tokenId` (a `crypto.randomUUID()` value) to `repository.create()`. TypeORM behavior when you explicitly set a value on a `PrimaryGeneratedColumn` field **is undefined by driver** — PostgreSQL will honour the provided UUID during INSERT (because the sequence is only used when the column value is absent), but this is not guaranteed to be portable and it violates the TypeORM contract.

The intent (use the tokenId as PK for O(1) lookup) is correct. The fix is to change the decorator to `@PrimaryColumn({ type: 'uuid' })` so the entity explicitly expects a caller-supplied PK.

```typescript
// refresh-token.entity.ts — change this:
@PrimaryGeneratedColumn('uuid')
id!: string;

// to:
@PrimaryColumn({ type: 'uuid' })
id!: string;
```

This also avoids the `@Index()` on `tokenHash` being necessary for performance — the new lookup goes directly by PK, so the `@Index()` on `tokenHash` is now dead weight (see M1 below).

---

### Medium Priority Improvements

#### M1: Stale `@Index()` on `tokenHash` in RefreshToken entity

`src/database/entities/refresh-token.entity.ts` line 18: `@Index()` on `tokenHash` is leftover from the old O(n) bcrypt scan approach. The composite token format does a PK lookup first; `tokenHash` is never queried directly. Remove it to avoid unnecessary index maintenance overhead.

#### M2: `refreshTokens()` — splits on first `:` only, but does not validate `tokenId` is a UUID format

**File:** `src/modules/auth/auth.service.ts` line 163

Current code uses `indexOf(':')` which correctly handles the case where the secret (a 64-char hex string) itself never contains `:`. However, there is no validation that `tokenId` is a valid UUID before the DB query. Passing a malformed string (e.g., a 5000-char string) as the `id` parameter to `findOne` causes unnecessary DB round-trips and potentially exposes DB error stack traces if TypeORM throws on type mismatch.

Recommend a UUID format check:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(tokenId)) {
  throw new UnauthorizedException('Invalid or expired refresh token');
}
```

#### M3: Google `email` field — empty string fallback instead of rejection

**File:** `src/modules/auth/strategies/google-id-token-validator.strategy.ts` line 36

```typescript
email: payload.email ?? '',
```

If `payload.email` is absent (can happen for Google Workspace accounts where email sharing is restricted), the user gets created with `email = ''`. This will either fail on the unique index (if another empty-email user exists) or create a broken account.

Should throw `UnauthorizedException` if email is absent:
```typescript
if (!payload.email) {
  throw new UnauthorizedException('Google account must have a verified email');
}
```

Same issue exists in `apple.strategy.ts` line 24 (`email: payload.email ?? ''`).

#### M4: `email_verified` field not checked in Google ID token validator

**File:** `src/modules/auth/strategies/google-id-token-validator.strategy.ts`

The Google token payload includes an `email_verified` boolean. Auto-linking is only safe when the email is verified — the code comment even says so. But `email_verified` is never checked.

```typescript
if (!payload.email_verified) {
  throw new UnauthorizedException('Google account email is not verified');
}
```

This is important because if `email_verified` is false, auto-linking to an existing account by email is unsafe and could allow account takeover.

#### M5: `oauthLogin` auto-link writes directly to entity field via dynamic key

**File:** `src/modules/auth/auth.service.ts` line 137

```typescript
existingEmailUser[providerColumn] = providerUser.providerId;
```

This mutation happens before the `save()` call, which is fine. However, because `providerColumn` is typed as a string (`'googleProviderId' | 'appleProviderId'`), TypeScript cannot enforce that the key actually exists on `User`. This could silently fail if the mapping is ever changed. A type-safe alternative:

```typescript
const update =
  provider === 'google'
    ? { googleProviderId: providerUser.providerId }
    : { appleProviderId: providerUser.providerId };
await this.userRepository.update({ id: existingEmailUser.id }, update);
user = existingEmailUser;
```

Using `repository.update()` is also safer under concurrent requests (avoids read-modify-write race).

#### M6: `ACCESS_TOKEN_EXPIRY = '30d'` is very long

**File:** `src/modules/auth/auth.service.ts` line 15

30-day access tokens negate much of the value of having refresh tokens. If an access token is leaked (logged, stored in a compromised client), it stays valid for 30 days. Standard practice is 15–60 minutes. This is a design decision, but it's a notable security trade-off worth flagging.

#### M7: `user.entity.ts` — `unique: true` on nullable `googleProviderId`/`appleProviderId` columns

**File:** `src/database/entities/user.entity.ts` lines 29, 32

TypeORM's `unique: true` creates a standard unique constraint, which in PostgreSQL includes NULLs as unique values per row only with a partial index (`WHERE col IS NOT NULL`). The migration correctly creates a partial unique index (`WHERE ... IS NOT NULL`). However, the `unique: true` in the entity decorator will also cause TypeORM schema sync/migrations to generate a separate non-partial unique constraint if `synchronize: true` or `migration:generate` is used, which would conflict.

Since the migration handles the index correctly, remove `unique: true` from the entity column decorators and rely solely on the migration-managed partial index:
```typescript
@Column({ type: 'varchar', length: 255, name: 'google_provider_id', nullable: true })
googleProviderId?: string;
```

---

### Low Priority Suggestions

#### L1: `bcrypt` rounds — inconsistency: 12 for passwords, 10 for refresh token secrets

**File:** `src/modules/auth/auth.service.ts` lines 14, 231

`BCRYPT_ROUNDS = 12` for passwords but the refresh token secret uses hardcoded `10`. Not a security problem (10 rounds is adequate for secrets), but a minor inconsistency. Consider extracting as a named constant.

#### L2: `linkOnboardingSession` logs the raw `sessionToken` value in a warning

**File:** `src/modules/auth/auth.service.ts` lines 212, 215

Session tokens are UUIDs and generally low sensitivity, but logging them in warnings means they appear in log aggregators. If logs are shipped to third parties (e.g., Sentry, Datadog), this is a minor data exposure. Consider logging only the first 8 chars or omitting entirely.

#### L3: `googleCallbackUrl` and `googleClientSecret` in config but unused

**File:** `src/config/app-configuration.ts` lines 65–66

The `callbackUrl` and `clientSecret` fields remain in `AppConfiguration.oauth.google` but the redirect flow was removed. These are dead config keys. Clean up to avoid confusion.

---

### Positive Observations

- Composite token design (`uuid:secret`, bcrypt of secret only) is correct and well-motivated. O(1) PK lookup is a meaningful performance improvement.
- Migration is safe: `ADD COLUMN IF NOT EXISTS`, partial unique indexes, idempotent data migration. The `down()` is honest about not un-revoking tokens.
- `oauthLogin` unified method is clean — no duplication between Google and Apple paths.
- `linkOnboardingSession` is correctly fire-and-forget (never throws), preventing auth failures from blocking user onboarding completion.
- Google idToken strategy correctly passes `audience: clientId` to prevent token audience confusion attacks.
- Error handling in `refreshTokens()` uses a consistent, generic message — no information leakage about whether the token ID exists.
- 53 tests all pass; test coverage for the new composite token format, auto-linking, and onboarding session flows is thorough.
- `auth.controller.ts` correctly marks all public endpoints with `@Public()` and correctly protects `/logout` with JWT.

---

### Recommended Actions

1. **[HIGH]** Change `@PrimaryGeneratedColumn('uuid')` to `@PrimaryColumn({ type: 'uuid' })` in `refresh-token.entity.ts` to make the explicit PK assignment contract explicit.
2. **[HIGH]** Add `email_verified` check in `google-id-token-validator.strategy.ts` before allowing auto-link by email.
3. **[MEDIUM]** Reject absent/empty emails in both Google and Apple strategies instead of falling back to `''`.
4. **[MEDIUM]** Add UUID format validation for `tokenId` in `refreshTokens()` before the DB query.
5. **[MEDIUM]** Remove `unique: true` from `googleProviderId`/`appleProviderId` entity columns — rely on migration-managed partial indexes.
6. **[MEDIUM]** Use `repository.update()` for the auto-link mutation to avoid read-modify-write race and improve type safety.
7. **[LOW]** Remove dead `callbackUrl`/`clientSecret` from `AppConfiguration.oauth.google`.
8. **[LOW]** Remove stale `@Index()` on `tokenHash` in `RefreshToken` entity.

---

### Metrics
- Build: PASS (clean, 0 errors)
- Tests: 53/53 PASS
- Linting: Not run (out of scope)
- Type Coverage: Good; one untyped dynamic key access (M5)

---

### Unresolved Questions

1. Is `ACCESS_TOKEN_EXPIRY = '30d'` intentional given the mobile app context? If yes, recommend documenting the rationale (e.g., better offline UX at the cost of revocation granularity).
2. Apple's `email_verified` behavior — Apple tokens may not always include this claim. Confirm whether the Apple strategy should enforce email verification similarly to Google, or whether Apple's verification guarantee is implicit by their token issuance policy.
3. Will `npm run migration:generate` be run after the `@PrimaryColumn` change? TypeORM may try to emit an ALTER on the PK if it detects the decorator change.
