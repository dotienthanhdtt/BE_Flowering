# Codebase Summary

**Last Updated:** 2026-03-08
**Generated from:** repomix-output.xml

## Overview

AI-powered language learning backend built with NestJS 11.x, TypeScript 5.x, and PostgreSQL (Supabase). Implements modular monolith architecture with 8 feature modules supporting authentication, AI-driven learning, onboarding, subscriptions, and push notifications.

## Metrics

- **Total TypeScript Files:** 129 files in src/
- **Code Lines:** ~7,500 LOC in src/
- **Modules:** 8 feature modules
- **Database Entities:** 14 TypeORM entities
- **API Endpoints:** 30+ REST endpoints
- **External Integrations:** 8 (Supabase, RevenueCat, Firebase, OpenAI, Anthropic, Google AI, Langfuse, Sentry)

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | NestJS 11.0 |
| Language | TypeScript 5.7 |
| Runtime | Node.js 20+ |
| Database | PostgreSQL 14+ (Supabase) |
| ORM | TypeORM 0.3.28 |
| Auth | JWT, Passport.js, bcrypt |
| AI | LangChain, multi-provider LLM |
| Subscriptions | RevenueCat |
| Notifications | Firebase Admin SDK |
| Observability | Langfuse, Sentry |
| Validation | class-validator, class-transformer, Joi |
| Monitoring | HTTP logger middleware |

## Module Structure

### 1. Auth Module (24 files, ~600 LOC)

**Purpose:** User authentication via email/password, Google ID token, Apple Sign-In with account auto-linking

**Endpoints:**
- POST /auth/register, /login, /google, /apple, /refresh, /logout
- POST /auth/forgot-password, /verify-otp, /reset-password

**Key Features:**
- Composite refresh tokens (uuid:hex format) for O(1) validation
- Auto-linking: OAuth accounts merge with existing email matches
- Provider-specific IDs (`googleProviderId`, `appleProviderId`) prevent duplicates
- Password reset: OTP (10min) + reset token (15min)

**Security:**
- bcrypt password hashing
- JWT HS256 (7d expiry)
- Google Auth Library for ID token verification

### 2. AI Module (~30 files, ~800 LOC)

**Purpose:** Multi-provider LLM integration via LangChain with Langfuse tracing

**Endpoints:**
- POST /ai/chat, /grammar/check, /exercises/generate, /pronunciation/assess
- POST /ai/conversations, GET /ai/conversations/:id/messages
- SSE /ai/chat/stream (Server-Sent Events)

**Supported Models:** GPT-4o, GPT-4o-mini, Claude 3.5 Sonnet, Claude 3 Haiku, Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash

**Rate Limiting:** 20 req/min, 100 req/hr per user

**Key Features:**
- Multi-provider strategy pattern (OpenAI, Anthropic, Gemini)
- Prompts stored as markdown in prompts/ directory
- Whisper audio transcription
- Langfuse tracing for all AI requests
- Async processing for long-running tasks

### 3. Onboarding Module (11 files, ~280 LOC)

**Purpose:** Anonymous session-based chat for new users

**Endpoints:**
- POST /onboarding/start, /onboarding/chat, /onboarding/complete

**Config:**
- maxTurns: 10
- sessionTtlDays: 7
- model: GPT-4o-mini
- maxTokens: 1024
- temperature: 0.7

**Features:**
- No authentication required
- Profile extraction via AI
- Scenario generation
- Session-based state management

### 4. Language Module (10 files, ~400 LOC)

**Purpose:** Language catalog and user language preferences

**Endpoints:**
- GET /languages (public, filterable by type)
- GET/POST /languages/user
- PATCH /languages/user/native
- PATCH/DELETE /languages/user/:id

**Entities:**
- Language: Available languages with `isNativeAvailable`, `isLearningAvailable`, `flagUrl`
- UserLanguage: User's learning languages with proficiency level

### 5. User Module (5 files, ~130 LOC)

**Purpose:** User profile management

**Endpoints:**
- GET /users/me
- PATCH /users/me

### 6. Subscription Module (6 files, ~400 LOC)

**Purpose:** RevenueCat subscription management

**Endpoints:**
- GET /subscriptions/me
- POST /webhooks/revenuecat (public, bearer auth)

**Webhook Events:** INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, PRODUCT_CHANGE

**Plans:** free, monthly, yearly, lifetime
**Status:** active, trial, expired, cancelled

**Security:** Timing-safe Bearer token validation

### 7. Notification Module (6 files, ~400 LOC)

**Purpose:** Firebase FCM push notifications

**Endpoints:**
- POST /notifications/devices
- DELETE /notifications/devices/:token

**Platforms:** ios, android, web

**Features:**
- Multi-device support per user
- Automatic token deduplication
- Device name tracking
- Last used timestamp for cleanup

### 8. Email Module (2 files, ~45 LOC)

**Purpose:** Nodemailer SMTP for OTP delivery

**Features:**
- OTP email sending for password reset
- Configured via SMTP environment variables

## Database Schema (14 Entities)

**Core:** User, Language, UserLanguage
**Content:** Lesson, Exercise
**Progress:** UserProgress, UserExerciseAttempt
**AI:** AiConversation, AiConversationMessage
**Infrastructure:** Subscription, DeviceToken, RefreshToken, PasswordReset

### User Entity Updates
- `googleProviderId` - OAuth account linking
- `appleProviderId` - OAuth account linking

### AiConversation Entity Updates
- `type` - ANONYMOUS or AUTHENTICATED
- `sessionToken` - Session identifier for anonymous users
- `expiresAt` - Session expiration (7 days)
- `messageCount` - Turn counter
- `metadata` - JSONB for flexible data storage

### PasswordReset Entity (New)
- `otpHash` - Hashed OTP
- `resetTokenHash` - Hashed reset token
- `attempts` - Failed attempt counter
- `expiresAt` - Token expiration

## Configuration

**Environment Variables:** .env validated via Joi schema

**Key Variables:**
- NODE_ENV, PORT
- DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET, JWT_EXPIRES_IN (default: 7d)
- OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY
- LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
- SENTRY_DSN
- REVENUECAT_API_KEY, REVENUECAT_WEBHOOK_SECRET
- FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM

## Global Infrastructure

### Middleware & Interceptors
- **ValidationPipe:** Auto-transform DTOs, whitelist unknown properties
- **ResponseTransformInterceptor:** Wraps all responses in `{code: 1, message, data}` format
- **AllExceptionsFilter:** Global exception handler with Sentry integration for 5xx
- **HttpLoggerMiddleware:** Logs incoming requests and responses
- **JwtAuthGuard:** Global auth (bypass with @Public())
- **CORS:** Configured via CORS_ALLOWED_ORIGINS env var

### Response Format
```json
{
  "code": 1,
  "message": "Success",
  "data": {...}
}
```

### Error Format
```json
{
  "code": 0,
  "message": "Error description",
  "data": null
}
```

## Security Patterns

**Authentication Flow:**
1. Email/password → bcrypt validation
2. Generate JWT + composite refresh token
3. Store refresh token with device info
4. On refresh: validate token, generate new pair

**OAuth Flow (Google/Apple):**
1. Client obtains ID token via SDK
2. POST /auth/{google|apple} with idToken
3. Backend verifies via provider library
4. Auto-link to existing email or create new account
5. Generate JWT token pair

**Webhook Security (RevenueCat):**
1. Bearer token in Authorization header
2. Timing-safe comparison vs REVENUECAT_WEBHOOK_SECRET
3. DTO validation
4. Respond <60s
5. Async processing via setImmediate()

**Database Security:**
- Row-Level Security (RLS) on all tables
- Service role key for backend operations
- User data isolation via user_id FK
- CASCADE deletion on user removal

## API Documentation

**Swagger UI:** Available at `/api/docs` in non-production

**Endpoints covered:**
- Auth (registration, login, OAuth, refresh, password reset)
- User profile management
- AI features (chat, grammar, exercises, pronunciation)
- Onboarding chat
- Languages (CRUD, user preferences)
- Subscriptions (status, webhooks)
- Notifications (device registration)

## Testing

**Framework:** Jest
**Unit Tests:** `.spec.ts` files next to source
**E2E Tests:** `test/` directory
**Commands:**
- `npm run test` - Unit tests
- `npm run test:watch` - Watch mode
- `npm run test:cov` - Coverage report
- `npm run test:e2e` - E2E tests

## Development Commands

**Startup:**
```bash
npm install
cp .env.example .env
npm run migration:run
npm run start:dev
```

**Database:**
```bash
npm run migration:generate -- src/database/migrations/Name
npm run migration:run
npm run migration:revert
```

**Code Quality:**
```bash
npm run lint
npm run format
npm run build
```

## Key Dependencies

**Framework:** @nestjs/core, @nestjs/common, @nestjs/config, @nestjs/jwt, @nestjs/passport, @nestjs/typeorm, @nestjs/swagger, @nestjs/throttler

**Database:** typeorm, pg, @supabase/supabase-js

**Auth:** passport, passport-jwt, google-auth-library, bcrypt, apple-signin-auth

**AI:** langchain, @langchain/core, @langchain/openai, @langchain/anthropic, @langchain/google-genai, openai, langfuse-langchain

**Services:** firebase-admin, nodemailer

**Validation:** class-validator, class-transformer, joi

**Observability:** @sentry/node

## Monitoring & Observability

**Sentry:** Captures 5xx exceptions, error tracking in production (configurable trace sample)

**Langfuse:** All AI requests traced with prompt, response, model, tokens, latency

**HTTP Logger:** Logs all incoming requests and outgoing responses

**NestJS Logger:** Contextual logging with module names, log levels (log, error, warn, debug, verbose)

## Deployment Considerations

- **Build:** `npm run build` compiles TypeScript to dist/
- **Start:** `npm run start:prod` runs built code
- **Migrations:** Run `npm run migration:run` before startup
- **Scaling:** Stateless design, DB connection pooling, refresh tokens in DB (multi-instance safe)
- **Files:** Use Supabase Storage for uploads (no local file storage)

## Future Enhancements

- Rate limiting per user (currently per IP)
- Redis caching layer
- Background job processing (Bull/BullMQ)
- Email notification service (SendGrid/Mailgun)
- Admin dashboard
- Analytics tracking
- Real-time features (WebSocket)
- GraphQL API
