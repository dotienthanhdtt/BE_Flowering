# NestJS Backend Codebase Scouting Report
**Date:** 2026-03-28  
**Commit:** 73cb1d9 (refactor: remove unused API endpoints not called by mobile app)

## Overview
The backend has undergone recent refactoring to remove ~1000 lines of dead code including exercises/generate, pronunciation/assess, conversations endpoints, and the entire notification module. Only endpoints actively called by the mobile app remain.

---

## Active API Endpoints (by Module)

### 1. **AUTH Module** (`/auth`)
Route prefix: `auth`

| Method | Endpoint | Description | Auth | Public |
|--------|----------|-------------|------|--------|
| POST | `auth/register` | Register with email/password | - | ✓ |
| POST | `auth/login` | Login with email/password | - | ✓ |
| POST | `auth/google` | Google Sign In (mobile-compatible) | - | ✓ |
| POST | `auth/apple` | Apple Sign In | - | ✓ |
| POST | `auth/refresh` | Refresh access token | - | ✓ |
| POST | `auth/forgot-password` | Send OTP to email | - | ✓ |
| POST | `auth/verify-otp` | Verify OTP, get reset token (15min) | - | ✓ |
| POST | `auth/reset-password` | Reset password with reset token | - | ✓ |
| POST | `auth/logout` | Logout & invalidate refresh tokens | JWT | - |

**Guards:** Global JWT auth (except @Public endpoints)

---

### 2. **AI Module** (`/ai`)
Route prefix: `ai`

| Method | Endpoint | Description | Auth | Guards | Premium |
|--------|----------|-------------|------|--------|---------|
| POST | `ai/chat` | Chat with AI tutor | JWT | ThrottlerGuard, PremiumGuard | ✓ Required |
| SSE | `ai/chat/stream` | Stream chat response (SSE) | JWT | ThrottlerGuard, PremiumGuard | ✓ Required |
| POST | `ai/chat/correct` | Check grammar/vocabulary of user reply | - | - | ✗ Public |
| POST | `ai/translate` | Translate word or sentence | Optional JWT | - | ✗ Public |

**Guards:** 
- ThrottlerGuard (rate limiting)
- PremiumGuard (for chat/chat-stream)
- @RequirePremium() decorator (applied at class level, bypassed for public endpoints)

**Note:** `chat/correct` and `translate` endpoints are publicly accessible for demo purposes despite @RequirePremium at class level (overridden by @Public + @RequirePremium(false)).

---

### 3. **LANGUAGES Module** (`/languages`)
Route prefix: `languages`

| Method | Endpoint | Description | Auth | Public |
|--------|----------|-------------|------|--------|
| GET | `languages` | List available languages (filter by type optional) | - | ✓ |
| GET | `languages/user` | Get user learning languages | JWT | - |
| POST | `languages/user` | Add language to user learning list | JWT | - |
| PATCH | `languages/user/native` | Set user native language | JWT | - |
| PATCH | `languages/user/:languageId` | Update user language proficiency | JWT | - |
| DELETE | `languages/user/:languageId` | Remove language from learning list | JWT | - |

**Guards:** Global JWT auth (except @Public endpoints)

---

### 4. **ONBOARDING Module** (`/onboarding`)
Route prefix: `onboarding`

| Method | Endpoint | Description | Auth | Public |
|--------|----------|-------------|------|--------|
| POST | `onboarding/start` | Start anonymous onboarding chat session | - | ✓ |
| POST | `onboarding/chat` | Send message in onboarding chat | - | ✓ |
| POST | `onboarding/complete` | Extract structured profile from conversation | - | ✓ |

**Guards:** None (all public)

---

### 5. **SUBSCRIPTION Module** (`/subscriptions`)
Route prefix: `subscriptions`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `subscriptions/me` | Get current user subscription | JWT |

**Guards:** Global JWT auth (ApiBearerAuth decorator)

---

### 6. **WEBHOOKS Module** (`/webhooks`)
Route prefix: `webhooks`

| Method | Endpoint | Description | Auth | Auth Header |
|--------|----------|-------------|------|-------------|
| POST | `webhooks/revenuecat` | RevenueCat webhook endpoint | - | Bearer token (timing-safe verified) |

**Guards:** Custom timing-safe Bearer token verification (prevents timing attacks)  
**Note:** Hidden from Swagger docs (@ApiExcludeEndpoint), asynchronous processing with 60s response requirement

---

### 7. **USER Module** (`/users`)
Route prefix: `users`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `users/me` | Get current user profile | JWT |
| PATCH | `users/me` | Update current user profile | JWT |

**Guards:** Global JWT auth (ApiBearerAuth decorator)

---

## Common Infrastructure (`src/common/`)

### Files Structure
```
src/common/
├── decorators/
│   ├── optional-auth.decorator.ts          # Allow optional JWT auth
│   ├── public-route.decorator.ts           # Mark endpoints as public
│   └── require-premium.decorator.ts        # Enforce premium requirement
├── dto/
│   └── base-response.dto.ts                # Base response DTO
├── filters/
│   └── all-exceptions.filter.ts            # Global exception filter
├── guards/
│   └── premium.guard.ts                    # Premium subscription guard
├── interceptors/
│   └── response-transform.interceptor.ts   # Transform HTTP responses
├── middleware/
│   └── http-logger.middleware.ts           # HTTP request logging
└── index.ts                                # Public exports
```

### Key Components

**Decorators:**
- `@Public()` - Bypasses global JWT guard
- `@RequirePremium(boolean?)` - Enforces/allows premium feature access
- `@OptionalAuth()` - Allows request with or without JWT

**Guards:**
- `PremiumGuard` - Validates user subscription status
- `ThrottlerGuard` - Rate limiting (via @nestjs/throttler)
- Global JWT Guard - Applied to all protected routes

**Filters:**
- `AllExceptionsFilter` - Centralized error handling

**Interceptors:**
- `ResponseTransformInterceptor` - Standardizes response format

**Middleware:**
- `HttpLoggerMiddleware` - Request/response logging

---

## Recent Refactoring (Commit 73cb1d9)

### Removed Endpoints (~1000 LOC deleted)
- ❌ `POST /ai/exercises/generate` - Exercise generation endpoint
- ❌ `POST /ai/pronunciation/assess` - Audio assessment endpoint  
- ❌ `GET /conversations` - Conversation history endpoint
- ❌ `POST /subscriptions/sync` - Subscription sync endpoint
- ❌ Entire `/notification` module
  - `POST /notifications/register-device`
  - `POST /notifications/send-notification`

### Removed Services
- `WhisperTranscriptionService` (audio transcription)
- `FirebaseService` (Firebase Cloud Messaging)

### Removed Prompts
- `exercise-generator-prompt.md`
- `pronunciation-assessment-prompt.md`

### Removed DTOs
- `GenerateExerciseDto`
- `PronunciationAssessmentDto`
- `RegisterDeviceDto`
- `SendNotificationDto`

---

## Authentication Flow
1. **Public endpoints** (@Public): No auth required
2. **Protected endpoints**: Global JWT guard validates Authorization header
3. **Premium features**: PremiumGuard checks user subscription status
4. **Optional auth** (@OptionalAuth): JWT validated if present, but not required
5. **Webhooks**: Custom Bearer token verification (timing-safe)

---

## Rate Limiting
- Applied via `@nestjs/throttler` and `ThrottlerGuard`
- Currently enabled on AI module (`chat`, `chat/stream`)
- Forgot-password endpoint: 3 requests/hour limit (enforced in service)

---

## Summary Statistics
- **Total Controllers:** 7
- **Total Endpoints:** 30 active HTTP endpoints + 1 SSE endpoint
- **Public Endpoints:** 11 (onboarding 3, auth 8, languages 1 public, ai/translate, ai/chat/correct, webhooks 1)
- **Protected Endpoints:** 19 (require JWT)
- **Premium-Only Endpoints:** 2 (ai/chat, ai/chat/stream)
- **Common Components:** 9 files (decorators, guards, filters, interceptors, middleware)

---

## Architecture Observations
✓ **Clean separation of concerns** - Modules organized by feature  
✓ **Consistent auth patterns** - Centralized decorators and guards  
✓ **Dead code removed** - Recent refactoring eliminated unused endpoints  
✓ **Rate limiting in place** - Throttler protection on resource-intensive endpoints  
✓ **Webhook security** - Timing-safe Bearer token verification for RevenueCat  
✓ **Premium feature gating** - PremiumGuard validates subscription status  
⚠ **Mixed SSE implementation** - chat/stream uses RxJS Subject (verify flow for prod)  
⚠ **Optional JWT on translate endpoint** - Allows anonymous usage, session token fallback  

---

## Unresolved Questions
- Current SSE (Server-Sent Events) implementation robustness - connection lifecycle management?
- RevenueCat webhook async processing - what happens if event processing fails beyond 60s response window?
- Premium feature degradation - what happens when user subscription expires mid-session (ai/chat)?
- Rate limit thresholds - what are current throttler limits and burst allowances?
