# Auth Module & Firebase Configuration Audit
**Date:** April 4, 2026 | **Project:** be_flowering (NestJS Backend)

---

## EXECUTIVE SUMMARY

The backend has a **sophisticated, production-ready authentication system** built on JWT with OAuth2 (Google/Apple), email/password flows, and password reset via OTP. Firebase is configured but **not actively used** for authentication—only imports exist in config. Current implementation is clean and migration-ready with clear separation of concerns.

---

## 1. CURRENT AUTH IMPLEMENTATION

### Architecture Overview
- **Auth Strategy:** JWT-based with Passport.js integration
- **Token Type:** Composite refresh tokens (UUID:secret format) stored with bcrypt hash
- **Providers:** Email/Password, Google OAuth2, Apple Sign-In
- **Session Management:** Onboarding conversation linking (anonymous→authenticated)

### Files & Responsibilities

#### Core Auth Files
| File | Purpose | Key Details |
|------|---------|-------------|
| `auth.controller.ts` | 8 endpoints | Register, Login, Google, Apple, Refresh, ForgotPassword, VerifyOtp, ResetPassword, Logout |
| `auth.service.ts` | Business logic | Token generation, OAuth validation, password reset flow, email masking |
| `auth.module.ts` | Module setup | JWT config, Passport, TypeORM entities, email service |

#### Strategies (Passport.js)
1. **JWT Strategy** (`jwt.strategy.ts`)
   - Extracts JWT from Bearer token
   - Validates token signature
   - Loads full User entity from database per request
   - Throws UnauthorizedException if user not found

2. **Google ID Token Strategy** (`google-id-token-validator.strategy.ts`)
   - Uses `google-auth-library` OAuth2Client
   - Verifies ID token signature against Google public keys
   - Enforces verified email requirement
   - Returns email, providerId, displayName, avatarUrl

3. **Google Passport Strategy** (`google.strategy.ts`)
   - For server-to-server OAuth flow (rarely used, web-based OAuth redirect)
   - Uses `passport-google-oauth20`
   - Requires clientID, clientSecret, callbackURL
   - **Status:** Present but not actively used by mobile/SPA clients

4. **Apple Strategy** (`apple.strategy.ts`)
   - Uses `apple-signin-auth` library
   - Verifies Apple ID token
   - Enforces email requirement
   - **Limitation:** Returns only email and providerId (no display name on subsequent logins)

#### Guards
1. **JwtAuthGuard** (`jwt-auth.guard.ts`)
   - Global guard applied to all routes by default
   - Respects `@Public()` decorator (allows anonymous access)
   - Respects `@OptionalAuth()` decorator (allows null user)
   - Extracts user from request via strategy validation

2. **GoogleAuthGuard** (`google-auth.guard.ts`)
   - Unused in current implementation
   - Would be needed if server-side OAuth redirect flow was used

#### Decorators
- `@CurrentUser()` - Extracts user from request (populated by JwtAuthGuard)
- `@Public()` - Marks routes as public (from common/decorators)
- `@OptionalAuth()` - Marks routes as optionally authenticated

---

## 2. AUTH FLOW DETAILS

### Email/Password Registration
```
POST /auth/register
├─ Validates email uniqueness
├─ Bcrypt hash password (12 rounds)
├─ Creates User entity
├─ Links onboarding conversation if provided
└─ Returns: accessToken, refreshToken, userDto
```

### Email/Password Login
```
POST /auth/login
├─ Finds user by email
├─ Validates passwordHash with bcrypt.compare
└─ Returns: accessToken, refreshToken, userDto
```

### Google OAuth (Mobile/SPA)
```
POST /auth/google
├─ Client sends ID token (from Google Sign-In SDK)
├─ Validates token with google-auth-library
├─ Enforces email_verified flag
├─ Finds by googleProviderId OR auto-links by email
├─ Creates new user if email not found
└─ Returns: accessToken, refreshToken, userDto
```

### Apple OAuth (Mobile)
```
POST /auth/apple
├─ Client sends ID token (from Sign in with Apple)
├─ Validates token with apple-signin-auth library
├─ Finds by appleProviderId OR auto-links by email
├─ Creates new user if email not found
├─ Note: displayName only on first sign-in
└─ Returns: accessToken, refreshToken, userDto
```

### Token Refresh
```
POST /auth/refresh
├─ Parses composite token format {tokenId}:{secret}
├─ O(1) lookup by tokenId (UUID primary key)
├─ Validates secret hash with bcrypt
├─ Revokes old token
├─ Generates new token pair
└─ Returns: accessToken, refreshToken, userDto
```

### Password Reset (OTP)
```
POST /auth/forgot-password
├─ Rate limit: 3 requests/hour per email
├─ Generates 6-digit OTP
├─ SHA256 hash for storage
├─ Expires in 10 minutes
├─ Sends via email (fire-and-forget, never expose SMTP errors)
└─ Returns: masked email (u***@domain.com)

POST /auth/verify-otp
├─ Validates OTP hash
├─ Enforces 5 attempt limit
├─ Generates 15-minute reset token
└─ Returns: resetToken (UUID format)

POST /auth/reset-password
├─ Validates reset token hash
├─ Prevents token reuse (used flag)
├─ Bcrypt new password
├─ Revokes all refresh tokens (force re-login on all devices)
└─ Returns: 204 No Content
```

### Logout
```
POST /auth/logout (requires @CurrentUser)
├─ Revokes all refresh tokens for user
└─ Returns: 204 No Content
```

---

## 3. DATA MODELS

### User Entity (`user.entity.ts`)
```typescript
Entity: users (PostgreSQL)
├─ id (UUID, PK)
├─ email (varchar 255, unique)
├─ passwordHash (varchar 255, nullable)
├─ authProvider (varchar 50, nullable) - "email" | "google" | "apple"
├─ providerId (varchar 255, nullable)
├─ googleProviderId (varchar 255, nullable, indexed)
├─ appleProviderId (varchar 255, nullable, indexed)
├─ displayName (varchar 100, nullable)
├─ avatarUrl (text, nullable)
├─ nativeLanguageId (UUID FK, nullable)
├─ createdAt (timestamptz)
└─ updatedAt (timestamptz)

Indexing: Partial unique indexes on googleProviderId and appleProviderId
(WHERE col IS NOT NULL) to allow multiple NULL values
```

### RefreshToken Entity (`refresh-token.entity.ts`)
```typescript
Entity: refresh_tokens (PostgreSQL)
├─ id (UUID, PK) - composite token part 1
├─ tokenHash (varchar 255) - bcrypt hash of token secret
├─ userId (UUID FK, cascade delete)
├─ expiresAt (timestamptz) - 90 days from creation
├─ revoked (boolean, default false)
└─ createdAt (timestamptz)

Token Format: {id}:{secret}
- id = UUID primary key (O(1) lookup)
- secret = 32-byte random hex (bcrypt verified)
```

### PasswordReset Entity (`password-reset.entity.ts`)
```typescript
Entity: password_resets (PostgreSQL)
├─ id (UUID, PK)
├─ email (varchar 255)
├─ otpHash (varchar 64) - SHA256(otp)
├─ resetTokenHash (varchar 64, nullable) - SHA256(resetToken)
├─ attempts (int, default 0) - OTP validation attempts
├─ expiresAt (timestamptz) - OTP expires in 10 minutes
├─ resetTokenExpiresAt (timestamptz, nullable) - reset token expires in 15 minutes
├─ used (boolean, default false) - prevent token reuse
└─ createdAt (timestamptz)

Index: (email, createdAt) for rate limiting queries
```

---

## 4. FIREBASE CONFIGURATION

### Current State
**Status:** Configured but **not used**

### Configuration Files
1. **`.env.example`** (lines 28-31)
   ```
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

2. **`app-configuration.ts`** (lines 47-51)
   ```typescript
   firebase: {
     projectId?: string;
     clientEmail?: string;
     privateKey?: string;
   };
   ```

3. **`environment-validation-schema.ts`** (lines 51-60)
   ```typescript
   FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
   FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
   FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
   ```

### Actual Usage
- **firebase-admin** package installed (`v13.6.0`)
- **No initialization code** found
- **No Cloud Messaging** implementation
- **No Firebase Auth** integration
- **No Firestore** usage

### Inference
Firebase appears reserved for:
- Future push notifications (Cloud Messaging)
- Possibly analytics/monitoring
- NOT currently part of authentication flow

---

## 5. PACKAGE.JSON DEPENDENCIES - AUTH RELEVANT

### Core Auth Libraries
| Package | Version | Purpose |
|---------|---------|---------|
| `@nestjs/jwt` | ^11.0.2 | JWT signing/verification |
| `@nestjs/passport` | ^11.0.5 | Passport.js integration |
| `passport` | ^0.7.0 | Authentication middleware |
| `passport-jwt` | ^4.0.1 | JWT extraction strategy |
| `passport-google-oauth20` | ^2.0.0 | Google OAuth strategy |
| `google-auth-library` | ^10.5.0 | Google ID token validation |
| `apple-signin-auth` | ^2.0.0 | Apple ID token validation |
| `bcrypt` | ^6.0.0 | Password hashing |

### Database/Storage
| Package | Version | Purpose |
|---------|---------|---------|
| `@nestjs/typeorm` | ^11.0.0 | ORM with PostgreSQL |
| `typeorm` | ^0.3.28 | Database abstraction |
| `pg` | ^8.18.0 | PostgreSQL driver |
| `@supabase/supabase-js` | ^2.93.3 | Supabase client (for storage) |

### Supporting
| Package | Version | Purpose |
|---------|---------|---------|
| `@nestjs/config` | ^4.0.0 | Environment config |
| `@nestjs/throttler` | ^6.5.0 | Rate limiting |
| `nodemailer` | ^8.0.1 | Email sending |
| `firebase-admin` | ^13.6.0 | Firebase SDK (not used) |

---

## 6. ENVIRONMENT VARIABLES (Auth-Related)

### Required
- `JWT_SECRET` - Must be ≥32 chars (validated with Joi)
- `JWT_EXPIRES_IN` - Default: "7d" (but hardcoded to "30d" in service)
- `GOOGLE_CLIENT_ID` - For Google OAuth
- `GOOGLE_CLIENT_SECRET` - For Google OAuth
- `APPLE_CLIENT_ID` - For Apple Sign-In
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_FROM` - For OTP emails

### Optional
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` - Not used
- `SENTRY_DSN` - Error tracking

### Note
⚠️ **Config Inconsistency:** `.env.example` shows `JWT_EXPIRES_IN=7d` but `auth.service.ts` hardcodes `ACCESS_TOKEN_EXPIRY = '30d'`. Service value takes precedence.

---

## 7. SECURITY POSTURE

### Strengths
✅ Passwords bcrypt hashed (12 rounds)
✅ Refresh tokens stored as bcrypt hashes (never plaintext)
✅ Composite token format prevents timing attacks
✅ OTP/reset tokens SHA256 hashed
✅ Token reuse prevention (revoke old on refresh)
✅ Email verification enforced for Google/Apple
✅ Auto-linking only via verified email (safe)
✅ Rate limiting on password reset (3/hour)
✅ Attempt limiting on OTP (5 attempts)
✅ Password reset revokes all devices
✅ CORS validation available
✅ Email masking in responses
✅ Fire-and-forget SMTP errors (never expose)

### Areas for Attention
⚠️ `GoogleStrategy` requires clientSecret (OAuth redirect flow not used by mobile)
⚠️ No HTTPS enforcement in code (assumed by deployment)
⚠️ No request signing/HMAC validation
⚠️ JWT_SECRET must be securely generated (32+ random chars)
⚠️ Firebase config present but unused (security debt)

---

## 8. READINESS FOR FIREBASE AUTH MIGRATION

### Migration Path
Firebase Auth would replace:
1. `auth.controller.ts` - Routes stay, JWT generation moves to Firebase
2. `auth.service.ts` - Core logic stays (user creation, linking, onboarding)
3. `jwt.strategy.ts` - Replaced with Firebase token verification
4. Email/password handlers - Could use Firebase Auth Emulator for testing
5. Google/Apple OAuth - Firebase handles entirely (no need for custom strategies)

### Blockers (None Critical)
- No Firebase Admin SDK initialization code
- No middleware for Firebase token extraction
- No session management strategy defined

### Advantages of Firebase Auth
✅ No JWT secret management
✅ Built-in Google/Apple OAuth (remove custom strategies)
✅ Email/password with built-in verification
✅ Multi-factor auth support
✅ Session management (via refresh tokens)
✅ Anonymous authentication support
✅ Custom claims support

### Migration Effort: **Moderate** (2-3 weeks)
- Keep: user entity structure, onboarding linking, password reset (can use email link)
- Replace: JWT generation, OAuth validation, email/password auth
- Add: Firebase Admin SDK init, token verification middleware

---

## 9. CURRENT TEST COVERAGE

`auth.service.spec.ts` exists with mocked:
- JwtService
- Repository layer (User, RefreshToken, PasswordReset, AiConversation)
- AppleStrategy, GoogleIdTokenStrategy
- EmailService

Tests cover:
- Register (happy path, duplicate email)
- Login (invalid credentials)
- Token refresh
- Password reset flow
- OTP verification

---

## 10. KEY IMPLEMENTATION DETAILS

### Composite Token Format
```typescript
// Generation
const tokenId = crypto.randomUUID();
const secret = crypto.randomBytes(32).toString('hex');
const rawToken = `${tokenId}:${secret}`;
const tokenHash = await bcrypt.hash(secret, 10);
// Stored: { id, tokenHash, userId, expiresAt, revoked }

// Verification
const separatorIndex = token.indexOf(':');
const tokenId = token.substring(0, separatorIndex);
const secret = token.substring(separatorIndex + 1);
const storedToken = db.findById(tokenId); // O(1)
const isValid = await bcrypt.compare(secret, storedToken.tokenHash);
```

### OAuth Auto-Linking Logic
```typescript
// Step 1: Check provider-specific column (indexed)
let user = findByProviderId(provider, id);

if (!user) {
  // Step 2: Check email (safe because emails verified by providers)
  const existing = findByEmail(email);
  if (existing) {
    // Auto-link: attach provider to existing account
    update(existing.id, { [providerColumn]: providerId });
  } else {
    // Step 3: Create new user
    user = create({ email, displayName, authProvider: provider });
  }
}
```

### Email Masking
```typescript
const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`; // user@example.com → u***@example.com
};
```

---

## 11. UNRESOLVED QUESTIONS

1. **Is Google Passport strategy used?** - Appears unused, could be removed or leveraged
2. **Is Firebase planned for auth or notifications?** - Config suggests future use
3. **What's the intended refresh token rotation strategy?** - Currently creates new per refresh, old is revoked
4. **Are there mobile SDKs for Google/Apple?** - Clients likely use native SDKs, backend validates tokens
5. **Email service is SMTP-only?** - No cloud email provider (SendGrid, etc.)
6. **Is the 30-day access token acceptable?** - Quite long, consider security trade-off

---

## 12. MIGRATION CHECKLIST (If Adopting Firebase Auth)

- [ ] Initialize Firebase Admin SDK in app module
- [ ] Create Firebase token verification middleware
- [ ] Implement Firebase UID → User entity mapping
- [ ] Migrate email/password to Firebase Auth
- [ ] Migrate Google OAuth to Firebase (remove custom strategy)
- [ ] Migrate Apple Sign-In to Firebase (remove custom strategy)
- [ ] Update auth.service to use Firebase API
- [ ] Keep onboarding conversation linking logic
- [ ] Implement custom claims for user ID
- [ ] Test token verification in JwtStrategy replacement
- [ ] Update env validation schema (remove Firebase service account secrets if using Firebase Auth)
- [ ] Update .env.example documentation

---

## FILES SUMMARY TABLE

| Path | Lines | Purpose | Status |
|------|-------|---------|--------|
| `src/modules/auth/auth.controller.ts` | 115 | HTTP endpoints | ✅ Production |
| `src/modules/auth/auth.service.ts` | 379 | Business logic | ✅ Production |
| `src/modules/auth/auth.module.ts` | 40 | DI setup | ✅ Production |
| `src/modules/auth/strategies/jwt.strategy.ts` | 43 | JWT validation | ✅ Production |
| `src/modules/auth/strategies/google-id-token-validator.strategy.ts` | 52 | Google ID token | ✅ Production |
| `src/modules/auth/strategies/google.strategy.ts` | 52 | Google OAuth (unused) | ⚠️ Unused |
| `src/modules/auth/strategies/apple.strategy.ts` | 35 | Apple Sign-In | ✅ Production |
| `src/modules/auth/guards/jwt-auth.guard.ts` | 52 | Auth enforcement | ✅ Production |
| `src/modules/auth/guards/google-auth.guard.ts` | 5 | OAuth enforcement (unused) | ⚠️ Unused |
| `src/modules/auth/dto/*.ts` | 8 files | Request validation | ✅ Production |
| `src/modules/auth/decorators/current-user.decorator.ts` | 7 | User injection | ✅ Production |
| `src/database/entities/user.entity.ts` | 55 | User model | ✅ Production |
| `src/database/entities/refresh-token.entity.ts` | 29 | Token model | ✅ Production |
| `src/database/entities/password-reset.entity.ts` | 32 | OTP model | ✅ Production |
| `src/config/app-configuration.ts` | 106 | Config schema | ✅ Production |
| `src/modules/email/email.service.ts` | 32 | OTP delivery | ✅ Production |

---

**Report Generated:** 2026-04-04 14:17 | **Reviewed By:** Code Explorer
