# Phase 03: Google ID Token Endpoint + Cleanup

## Context Links
- [Plan overview](plan.md)
- [Brainstorm](../reports/brainstorm-260224-1322-auth-improvements-onboarding-linking.md)
- [auth.controller.ts](../../src/modules/auth/auth.controller.ts)
- [auth.service.ts](../../src/modules/auth/auth.service.ts)
- [auth.module.ts](../../src/modules/auth/auth.module.ts)
- [apple.strategy.ts](../../src/modules/auth/strategies/apple.strategy.ts) (pattern reference)
- [apple-auth.dto.ts](../../src/modules/auth/dto/apple-auth.dto.ts) (pattern reference)

## Overview
- **Priority:** HIGH
- **Status:** completed
- **Description:** Replace Passport redirect Google OAuth with `POST /auth/google` accepting idToken. Mirror Apple auth pattern. Delete old redirect flow files.

## Key Insights
- Apple auth already uses the idToken pattern — mirror it exactly for Google
- `google-auth-library` provides `OAuth2Client.verifyIdToken()` for server-side validation
- Only need `GOOGLE_CLIENT_ID` for verification (no client secret needed for idToken validation)
- Can remove `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` env vars (no longer needed)
- `passport-google-oauth20` package can be uninstalled after cleanup

## Requirements
### Functional
- `POST /auth/google` accepts `{ idToken, displayName?, sessionToken? }`
- Validates Google ID token server-side using `google-auth-library`
- Extracts email, name, photo, sub (providerId) from token payload
- Creates/finds user and returns JWT tokens (reuses updated `oauthLogin` from Phase 04)
- Remove GET /auth/google and GET /auth/google/callback endpoints

### Non-functional
- Mobile-compatible (no redirect flow)
- Supports sessionToken for onboarding linking

## Architecture

**New Google Auth Flow:**
```
Mobile App → Google Sign-In SDK → gets idToken
Mobile App → POST /auth/google { idToken, displayName?, sessionToken? }
Backend → OAuth2Client.verifyIdToken(idToken, { audience: GOOGLE_CLIENT_ID })
Backend → Extract { email, sub, name, picture } from payload
Backend → oauthLogin(googleUser, 'google', sessionToken)
Backend → Return { accessToken, refreshToken, user }
```

## Related Code Files
- **Create:** `src/modules/auth/dto/google-auth.dto.ts`
- **Create:** `src/modules/auth/strategies/google-id-token.strategy.ts`
- **Delete:** `src/modules/auth/strategies/google.strategy.ts`
- **Delete:** `src/modules/auth/guards/google-auth.guard.ts`
- **Modify:** `src/modules/auth/auth.controller.ts` — remove GET google endpoints, add POST google
- **Modify:** `src/modules/auth/auth.service.ts` — add `googleLogin()` method
- **Modify:** `src/modules/auth/auth.module.ts` — swap providers
- **Modify:** `src/modules/auth/strategies/index.ts` — update exports
- **Modify:** `src/modules/auth/guards/index.ts` — remove GoogleAuthGuard export
- **Modify:** `src/modules/auth/dto/index.ts` — add GoogleAuthDto export
- **Modify:** `src/config/app-configuration.ts` — can remove clientSecret/callbackUrl (optional cleanup)
- **Modify:** `src/config/environment-validation-schema.ts` — remove GOOGLE_CLIENT_SECRET/GOOGLE_CALLBACK_URL validation

## Implementation Steps

1. Install `google-auth-library` (check if already available first):
   ```bash
   npm install google-auth-library
   ```

2. Create `google-auth.dto.ts` (mirror `apple-auth.dto.ts`):
   ```typescript
   export class GoogleAuthDto {
     @IsString() idToken: string;
     @IsString() @IsOptional() displayName?: string;
     @IsUUID() @IsOptional() sessionToken?: string;
   }
   ```

3. Create `google-id-token.strategy.ts` (mirror `apple.strategy.ts`):
   - Injectable service (not Passport strategy)
   - Constructor: inject ConfigService, create OAuth2Client
   - `validate(idToken: string)`: verifyIdToken, return `{ email, providerId, displayName, avatarUrl }`

4. Add `googleLogin()` to `auth.service.ts`:
   ```typescript
   async googleLogin(idToken: string, displayName?: string, sessionToken?: string): Promise<AuthResponseDto>
   ```
   - Calls googleStrategy.validate(idToken)
   - Calls oauthLogin() with the result (will use Phase 04 auto-link version)

5. Update `auth.controller.ts`:
   - Remove `googleAuth()` and `googleCallback()` methods
   - Add `POST /auth/google` using `GoogleAuthDto`

6. Update `auth.module.ts`:
   - Remove `googleStrategyProvider` factory
   - Add `GoogleIdTokenStrategy` as regular provider
   - Remove `GoogleStrategy` import

7. Delete old files:
   - `src/modules/auth/strategies/google.strategy.ts`
   - `src/modules/auth/guards/google-auth.guard.ts`

8. Update barrel exports:
   - `strategies/index.ts` — replace `google.strategy` with `google-id-token.strategy`
   - `guards/index.ts` — remove `google-auth.guard` export
   - `dto/index.ts` — add `google-auth.dto` export

9. Run `npm run build` to verify

## Todo List
- [x] Install google-auth-library
- [x] Create GoogleAuthDto
- [x] Create GoogleIdTokenStrategy service
- [x] Add googleLogin() to AuthService
- [x] Update AuthController (remove GET, add POST)
- [x] Update AuthModule providers
- [x] Delete google.strategy.ts
- [x] Delete google-auth.guard.ts
- [x] Update barrel exports (strategies, guards, dto)
- [x] Verify build compiles

## Success Criteria
- `POST /auth/google` accepts idToken and returns JWT tokens
- No more GET /auth/google or /auth/google/callback endpoints
- google.strategy.ts and google-auth.guard.ts deleted
- Build compiles without errors
- GoogleIdTokenStrategy validates tokens via google-auth-library

## Risk Assessment
- **google-auth-library conflicts:** May conflict with existing packages — test carefully
- **GOOGLE_CLIENT_ID reuse:** Same client ID works for both web and mobile SDK

## Security Considerations
- Always verify audience matches our GOOGLE_CLIENT_ID
- Google emails are always verified — safe for auto-linking (Phase 04)
- idToken has short expiry — validates freshness

## Next Steps
- Phase 04 will update `oauthLogin()` to use new provider columns + auto-linking
