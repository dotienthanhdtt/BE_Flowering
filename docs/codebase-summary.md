# Codebase Summary

**Last Updated:** 2026-04-12
**Generated from:** repomix-output.xml (updated 2026-04-12)

## Overview

AI-powered language learning backend built with NestJS 11.x, TypeScript 5.x, and PostgreSQL (Supabase). Implements modular monolith architecture with 7 feature modules supporting authentication, AI-driven learning, onboarding, subscriptions, and language management.

## Metrics

- **Total TypeScript Files:** ~160 files in src/
- **Code Lines:** ~9,500 LOC in src/
- **Modules:** 10 feature modules (added Lesson, Scenario Chat, and Vocabulary modules)
- **Database Entities:** 16 TypeORM entities (Vocabulary enhanced with SRS columns)
- **API Endpoints:** 39 REST endpoints (added 6 vocabulary endpoints: GET /vocabulary, GET /vocabulary/:id, DELETE /vocabulary/:id, POST /vocabulary/review/start, POST /vocabulary/review/:sessionId/rate, POST /vocabulary/review/:sessionId/complete)
- **External Integrations:** 7 (Supabase, RevenueCat, OpenAI, Anthropic, Google AI, Langfuse, Sentry)

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
| Observability | Langfuse, Sentry |
| Validation | class-validator, class-transformer, Joi |
| Monitoring | HTTP logger middleware |

## API Conventions

**JSON Key Naming:** All HTTP request/response JSON keys use `snake_case` for serialization. Internal TypeScript code remains `camelCase`. Exception: Wrapper keys `code`, `message`, `data` are single-word and unchanged.

## Module Structure

### 1. Auth Module (27 files, ~3,567 LOC)

**Purpose:** User authentication via email/password, Firebase unified sign-in (Google/Apple) with account auto-linking

**Endpoints:**
- POST /auth/register, /login, /firebase, /refresh, /logout
- POST /auth/forgot-password, /verify-otp, /reset-password

**Key Features:**
- Composite refresh tokens (uuid:hex format) for O(1) validation
- Firebase Auth unified endpoint: auto-detects Google or Apple provider from token claims
- Auto-linking: OAuth accounts merge with existing email matches
- Provider-specific IDs (`googleProviderId`, `appleProviderId`) prevent duplicates
- Password reset: OTP (10min) + reset token (15min)

**Security:**
- bcrypt password hashing
- JWT HS256 (7d expiry)
- Firebase Admin SDK for ID token verification

### 2. AI Module (~30 files, ~2,200 LOC)

**Purpose:** Multi-provider LLM integration via LangChain with Langfuse tracing + Speech-to-Text (STT) transcription

**Endpoints:**
- POST /ai/chat (premium-only)
- SSE /ai/chat/stream (Server-Sent Events, premium-only)
- POST /ai/chat/correct (grammar correction with context, public + optional premium)
- POST /ai/translate (word/sentence translation, public + optional premium)
- POST /ai/transcribe (audio to text transcription, premium-only, multipart/form-data)

**Supported Models:** GPT-4o, GPT-4o-mini, GPT-4.1-nano, Claude 3.5 Sonnet, Claude 3 Haiku, Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash

**Rate Limiting:** 20 req/min, 100 req/hr per user

**Key Features:**
- Multi-provider strategy pattern (OpenAI, Anthropic, Gemini for LLM)
- STT providers (OpenAI Whisper primary, Gemini multimodal fallback)
- Prompts stored as markdown in prompts/ directory (9 templates)
- Langfuse tracing with per-invocation handlers and explicit flushAsync
- Async processing for long-running tasks
- Translation service (word/sentence) with vocabulary storage
- Correction check endpoint with context awareness, ignores punctuation/capitalization
- Transcription service with audio persistence (Supabase storage) and multi-provider fallback

**STT Configuration:**
- `STT_PROVIDER` env var: `openai` (default) or `gemini`
- Automatic fallback to secondary provider if primary unavailable
- Max file size: 10MB
- Supported formats: M4A, MP4, MPEG, WAV

### 3. Onboarding Module (11 files, ~1,309 LOC)

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

### 4. Language Module (9 files, 570 LOC)

**Purpose:** Language catalog and user language preferences

**Endpoints:**
- GET /languages (public, filterable by type)
- GET/POST /languages/user
- PATCH /languages/user/native
- PATCH/DELETE /languages/user/:id

**Entities:**
- Language: Available languages with `isNativeAvailable`, `isLearningAvailable`, `flagUrl`
- UserLanguage: User's learning languages with proficiency level

### 5. User Module (5 files, 179 LOC)

**Purpose:** User profile management

**Endpoints:**
- GET /users/me
- PATCH /users/me

### 6. Subscription Module (6 files, 404 LOC)

**Purpose:** RevenueCat subscription management with sync endpoint and DB-based idempotency

**Endpoints:**
- GET /subscriptions/me (get user's subscription)
- POST /subscriptions/sync (sync with RevenueCat API, called by mobile)
- POST /webhooks/revenuecat (public, bearer auth, idempotent)

**Webhook Events:** INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, PRODUCT_CHANGE

**Plans:** free, monthly, yearly, lifetime
**Status:** active, trial, expired, cancelled

**Idempotency:** DB-based (WebhookEvent table) replaces in-memory Set for reliability across restarts

**Security:** Timing-safe Bearer token validation

### 7. Email Module (2 files, 43 LOC)

**Purpose:** Nodemailer SMTP for OTP delivery

**Features:**
- OTP email sending for password reset
- Configured via SMTP environment variables

### 8. Lesson Module (6 files, ~400 LOC)

**Purpose:** Home screen lessons API with scenario grouping and visibility rules

**Endpoints:**
- GET /lessons (paginated, filterable scenarios grouped by category)

**Features:**
- Global scenarios (language_id = NULL) visible to all users
- Language-specific scenarios filtered by user language preference
- User-granted access via user_scenario_access table
- Scenario status computation: available, trial, locked, learned (based on subscription)
- Premium subscription enforcement (free users see trial-only scenarios)
- Search, difficulty level filtering
- Pagination with total count

**Entities:**
- ScenarioCategory: Groups scenarios by topic/category
- Scenario: Learning content with difficulty levels, premium flags, trial flags
- UserScenarioAccess: Grants specific users access to scenarios

### 9. Scenario Chat Module (7 files, ~600 LOC)

**Purpose:** Premium scenario roleplay conversation engine with turn-based interactions

**Endpoints:**
- POST /scenario/chat (roleplay conversation with AI)

**Services:**
- ScenarioChatService: Main conversation logic, turn management, completion tracking
- ScenarioAccessService: Permission checks for premium scenarios vs. free users

**Features:**
- Turn-based roleplay conversations with configurable max turns (default: 10)
- AI-initiated first turn (omit message parameter)
- Conversation resumption via conversation_id
- Premium access control (free users blocked from premium scenarios)
- AiConversation entity extended with `scenario_id` FK
- Rate limiting: 20 req/min, 100 req/hr per user
- Automatic conversation completion tracking

**Rate Limiting:** Shared with AI endpoints (20 req/min, 100 req/hr)

### 10. Vocabulary Module (16 files, ~800 LOC)

**Purpose:** Premium scenario roleplay conversation engine with turn-based interactions

**Endpoints:**
- POST /scenario/chat (roleplay conversation with AI)

**Services:**
- ScenarioChatService: Main conversation logic, turn management, completion tracking
- ScenarioAccessService: Permission checks for premium scenarios vs. free users

**Features:**
- Turn-based roleplay conversations with configurable max turns (default: 10)
- AI-initiated first turn (omit message parameter)
- Conversation resumption via conversation_id
- Premium access control (free users blocked from premium scenarios)
- AiConversation entity extended with `scenario_id` FK
- Rate limiting: 20 req/min, 100 req/hr per user
- Automatic conversation completion tracking

**Rate Limiting:** Shared with AI endpoints (20 req/min, 100 req/hr)

**Purpose:** User vocabulary management with Leitner 5-box spaced repetition system (SRS)

**Endpoints:**
- GET /vocabulary (paginated list with filters)
- GET /vocabulary/:id (single item)
- DELETE /vocabulary/:id (delete item)
- POST /vocabulary/review/start (begin review session, fetch due cards)
- POST /vocabulary/review/:sessionId/rate (rate card, apply Leitner transition)
- POST /vocabulary/review/:sessionId/complete (finish session, return stats)

**Services:**
- VocabularyService: CRUD operations, pagination, filtering by language/box/search
- VocabularyReviewService: Session orchestration, Leitner state transitions, card rating
- ReviewSessionStore: In-memory session storage with 1h TTL and 5m cleanup sweep
- leitner.ts: Pure Leitner algorithm (box transitions, interval calculations)

**Key Features:**
- Leitner intervals: box 1→2 (+3d correct), box 2→3 (+7d), box 3→4 (+14d), box 4→5 (+30d), box 5→5 (cap +30d), any→1 (+1d wrong)
- Session-based review: cards marked due in session, one rating per card, session expires after 1h
- Auto-save regression prevention: POST /ai/translate (type=word) upserts without resetting SRS fields (orUpdate excludes box/dueAt/lastReviewedAt/etc.)
- Full test coverage (4 spec files): unit tests for CRUD, Leitner transitions, session store, review service
- No rate limits on review endpoints (not AI-powered)

## Database Schema (16 Entities)

**Core:** User, Language, UserLanguage
**Content:** Lesson, Exercise, ScenarioCategory, Scenario, UserScenarioAccess
**Progress:** UserProgress, UserExerciseAttempt
**AI:** AiConversation, AiConversationMessage, Vocabulary
**Infrastructure:** Subscription, RefreshToken, PasswordReset, WebhookEvent

### ScenarioCategory Entity
- `id` - UUID primary key
- `name` - String (max 100, e.g., "Greetings", "Food")
- `icon` - Text (icon URL, nullable)
- `order_index` - Integer for display ordering
- `is_active` - Boolean (default: true)
- Created/updated timestamps

### Scenario Entity
- `id` - UUID primary key
- `category_id` - FK to ScenarioCategory (ON DELETE CASCADE)
- `language_id` - FK to Language (nullable, NULL = global to all languages)
- `creator_id` - FK to User (nullable, for future KOL support)
- `gift_code` - String (max 50, nullable, unique)
- `title` - String (max 255, e.g., "Meet & Greet")
- `description` - Text (nullable)
- `image_url` - Text (nullable)
- `difficulty` - Enum (beginner, intermediate, advanced)
- `is_premium` - Boolean (default: false, requires paid subscription)
- `is_trial` - Boolean (default: false, visible to free users)
- `is_active` - Boolean (default: true)
- `order_index` - Integer for display ordering within category
- Created/updated timestamps

### UserScenarioAccess Entity
- `id` - UUID primary key
- `user_id` - FK to User (ON DELETE CASCADE)
- `scenario_id` - FK to Scenario (ON DELETE CASCADE)
- `granted_at` - Timestamp (when access was granted, default: now)
- Unique constraint: (user_id, scenario_id) for one-to-one grants

### Vocabulary Entity (Enhanced with SRS)
- `id` - UUID primary key
- `userId` - FK to User
- `word` - String (lexeme)
- `translation` - String
- `sourceLang` - String (max 10, e.g., "en", "ja")
- `targetLang` - String (max 10)
- `partOfSpeech` - String (noun, verb, etc., nullable)
- `pronunciation` - String (IPA, nullable)
- `definition` - Text (nullable)
- `examples` - JSONB (array of example sentences, nullable)
- **SRS Fields (NEW):**
  - `box` - smallint (1-5, CHECK constraint, default: 1)
  - `dueAt` - timestamptz (when next review due, default: NOW())
  - `lastReviewedAt` - timestamptz (last review timestamp, nullable)
  - `reviewCount` - int (total reviews, default: 0)
  - `correctCount` - int (correct reviews, default: 0)
- Unique constraint: (userId, word, sourceLang, targetLang)
- **Index:** idx_vocabulary_user_due on (user_id, due_at) for efficient due cards lookup
- **Migration:** 1775800000000-add-srs-columns-to-vocabulary.ts

### User Entity Updates
- `googleProviderId` - OAuth account linking
- `appleProviderId` - OAuth account linking

### AiConversation Entity Updates
- `type` - ANONYMOUS or AUTHENTICATED
- `id` - UUID primary key (conversation identifier for all sessions)
- `expiresAt` - Session expiration (7 days)
- `messageCount` - Turn counter
- `metadata` - JSONB for flexible data storage
- `scenarioId` - FK to Scenario (nullable, indicates scenario chat conversation)

### AiConversationMessage Entity Updates
- `translatedContent` - Cached sentence translation
- `translatedLang` - Language code of translation

### PasswordReset Entity (New)
- `otpHash` - Hashed OTP
- `resetTokenHash` - Hashed reset token
- `attempts` - Failed attempt counter
- `expiresAt` - Token expiration

### WebhookEvent Entity (New - 2026-03-14)
- `eventId` - Primary key from RevenueCat webhook
- `eventType` - Event type (e.g., INITIAL_PURCHASE, RENEWAL)
- `processedAt` - Timestamp when webhook was processed
- **Purpose:** Webhook idempotency - prevents duplicate processing across server restarts
- **Registration:** Both database.module.ts and subscription.module.ts

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
- **JwtAuthGuard:** Global auth (bypass with @Public(), optional with @OptionalAuth())
- **PremiumGuard:** Checks active premium subscription (used with @RequirePremium() on AI endpoints)
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
- AI features (chat, translation, correction)
- Onboarding chat
- Languages (CRUD, user preferences)
- Subscriptions (status, webhooks)

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

**Auth:** passport, passport-jwt, firebase-admin, bcrypt

**AI:** langchain, @langchain/core, @langchain/openai, @langchain/anthropic, @langchain/google-genai, openai, langfuse-langchain

**Services:** firebase-admin, nodemailer

**Validation:** class-validator, class-transformer, joi

**Observability:** @sentry/node

## Monitoring & Observability

**Sentry:** Captures 5xx exceptions, error tracking in production (configurable trace sample)

**Langfuse:** All AI requests traced with prompt, response, model, tokens, latency. Fresh CallbackHandler per invocation with explicit await handler.flushAsync() in finally blocks to ensure output flushing across all 3 LLM providers (OpenAI, Anthropic, Gemini).

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
