# Codebase Summary

**Last Updated:** 2026-02-24
**Generated from:** repomix-output.xml

## Overview

AI-powered language learning backend built with NestJS 11.x, TypeScript 5.x, and PostgreSQL (Supabase). Implements modular monolith architecture with 6 feature modules supporting authentication, AI-driven learning, subscriptions, and push notifications.

## Metrics

- **Total TypeScript Files:** 99 files in src/
- **Code Lines:** ~5,356 LOC in src/
- **Modules:** 6 feature modules (auth, user, language, ai, subscription, notification)
- **Database Entities:** 12 TypeORM entities
- **API Endpoints:** 20+ REST endpoints
- **External Integrations:** 7 (Supabase, RevenueCat, Firebase, OpenAI, Anthropic, Google AI, Langfuse)

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | NestJS 11.0 |
| Language | TypeScript 5.7 |
| Runtime | Node.js 18+ |
| Database | PostgreSQL 14+ (Supabase) |
| ORM | TypeORM 0.3.28 |
| Auth | JWT, Passport.js, bcrypt |
| AI | LangChain, OpenAI, Anthropic, Google AI |
| Subscriptions | RevenueCat |
| Notifications | Firebase Admin SDK |
| Observability | Langfuse, Sentry |
| Validation | class-validator, class-transformer, Joi |
| Documentation | Swagger (NestJS OpenAPI) |
| Rate Limiting | @nestjs/throttler |

## Project Structure

```
src/
├── main.ts                     # Entry point, Swagger setup, global config
├── app.module.ts               # Root module with global JwtAuthGuard
├── app.controller.ts           # Health check endpoint
├── app.service.ts              # Basic app service
│
├── common/                     # Cross-cutting concerns
│   ├── decorators/
│   │   ├── current-user.decorator.ts      # @CurrentUser() - Extract user from JWT
│   │   └── public-route.decorator.ts      # @Public() - Bypass global auth
│   ├── dto/
│   │   ├── base-response.dto.ts           # {code: 1, message, data}
│   │   └── pagination.dto.ts              # Pagination query params
│   ├── filters/
│   │   └── all-exceptions.filter.ts       # Global exception handler
│   ├── guards/
│   │   └── [deprecated guards]            # Migrated to modules
│   └── interceptors/
│       └── response-transform.interceptor.ts  # Wrap responses in BaseResponseDto
│
├── config/                     # Configuration management
│   ├── app-configuration.ts               # Config factory for ConfigModule
│   └── environment-validation-schema.ts   # Joi schema for .env validation
│
├── database/                   # Database infrastructure
│   ├── entities/              # TypeORM entities (12 total)
│   │   ├── user.entity.ts
│   │   ├── refresh-token.entity.ts
│   │   ├── language.entity.ts
│   │   ├── user-language.entity.ts
│   │   ├── lesson.entity.ts
│   │   ├── exercise.entity.ts
│   │   ├── user-progress.entity.ts
│   │   ├── user-exercise-attempt.entity.ts
│   │   ├── subscription.entity.ts
│   │   ├── ai-conversation.entity.ts
│   │   ├── ai-conversation-message.entity.ts
│   │   └── device-token.entity.ts
│   ├── migrations/            # TypeORM migrations (timestamped)
│   │   └── 1706976000000-initial-schema.ts
│   ├── database.module.ts     # TypeORM configuration
│   ├── supabase-storage.service.ts  # Supabase Storage for file uploads
│   └── typeorm-data-source.ts       # CLI data source for migrations
│
├── swagger/                    # API documentation
│   └── swagger-documentation-setup.ts  # Swagger config
│
└── modules/                    # Feature modules (domain-driven)
    ├── auth/                  # Authentication & authorization
    ├── user/                  # User profile management
    ├── language/              # Language preferences & proficiency
    ├── ai/                    # AI-powered learning features
    ├── subscription/          # RevenueCat subscription management
    └── notification/          # Firebase push notifications
```

## Module Details

### 1. Auth Module (`src/modules/auth/`)

**Purpose:** User authentication via email/password, Google ID token, Apple Sign-In with auto-linking

**Key Components:**
- `auth.service.ts` - Registration, login, token refresh, OAuth validation, auto-account-linking
- `jwt.strategy.ts` - Passport JWT strategy (validates tokens)
- `google-id-token-validator.strategy.ts` - Google ID token validation using google-auth-library
- `apple.strategy.ts` - Apple Sign-In strategy
- `jwt-auth.guard.ts` - Global guard (applied via APP_GUARD)

**DTOs:** `register.dto.ts`, `login.dto.ts`, `refresh-token.dto.ts`, `apple-auth.dto.ts`, `google-auth.dto.ts`

**Endpoints:**
- `POST /auth/register` - Email/password signup
- `POST /auth/login` - Email/password login
- `POST /auth/google` - Google ID token authentication (idToken, displayName, sessionToken)
- `POST /auth/apple` - Apple Sign-In callback
- `POST /auth/refresh` - Refresh access token (composite format: uuid:hex)
- `POST /auth/logout` - Logout (invalidate refresh token)

**Key Features:**
- **Composite Refresh Tokens:** Format `{uuid}:{hex}` enables O(1) PK lookup vs O(n) bcrypt scan
- **Auto-linking:** OAuth accounts auto-link to existing email matches instead of conflict error
- **Provider-specific IDs:** `googleProviderId` + `appleProviderId` columns prevent duplicate OAuth accounts

**Security:**
- bcrypt password hashing (6.0.0)
- JWT tokens (HS256, 7d expiry)
- Composite refresh token format for efficient validation
- Provider ID tracking for account deduplication
- Google ID token verified via google-auth-library (not deprecated strategy)

### 2. User Module (`src/modules/user/`)

**Purpose:** User profile management

**Key Components:**
- `user.service.ts` - Profile CRUD operations
- `user.controller.ts` - Profile endpoints

**DTOs:** `update-user-profile.dto.ts`

**Endpoints:**
- `GET /users/me` - Get current user profile
- `PATCH /users/me` - Update profile (name, profile_picture)

**Relations:** User → UserLanguage, Subscription, DeviceToken, AiConversation, RefreshToken

### 3. Language Module (`src/modules/language/`)

**Purpose:** Language catalog and user language preferences

**Key Components:**
- `language.service.ts` - Language management, proficiency tracking
- `language.controller.ts` - Language endpoints

**DTOs:** `add-user-language.dto.ts`, `update-user-language.dto.ts`

**Endpoints:**
- `GET /language` - List all available languages (public)
- `GET /language/user` - Get user's learning languages
- `POST /language/user` - Add language to learning list
- `PATCH /language/user/:languageId` - Update proficiency level
- `DELETE /language/user/:languageId` - Remove language from list

**Entities:**
- `Language` - Available languages (e.g., English, Spanish)
- `UserLanguage` - User's target languages with proficiency level

### 4. AI Module (`src/modules/ai/`)

**Purpose:** AI-powered language learning features using LangChain

**Architecture:**
- Multi-provider support (OpenAI, Anthropic, Google AI)
- LangChain agent framework for complex workflows
- Langfuse tracing for observability
- SSE streaming for real-time chat responses

**Key Services:**
- `learning-agent.service.ts` - Main orchestration (chat, grammar, exercises)
- `unified-llm.service.ts` - Multi-provider LLM abstraction
- `openai-llm.provider.ts` - OpenAI GPT-4, GPT-3.5
- `anthropic-llm.provider.ts` - Claude Sonnet, Opus, Haiku
- `gemini-llm.provider.ts` - Gemini Pro, Flash
- `prompt-loader.service.ts` - Load system prompts from files
- `langfuse-tracing.service.ts` - Request tracing & analytics
- `whisper-transcription.service.ts` - Audio → text (pronunciation assessment)

**10 Supported Models:**
- OpenAI: gpt-4, gpt-4-turbo, gpt-3.5-turbo
- Anthropic: claude-sonnet-4-20250514, claude-opus-4, claude-haiku-3-5
- Google AI: gemini-2.0-flash-exp, gemini-1.5-pro, gemini-1.5-flash, gemini-1.0-pro

**DTOs:** `chat-request.dto.ts`, `grammar-check-request.dto.ts`, `generate-exercise-request.dto.ts`, `pronunciation-assessment-request.dto.ts`, `create-conversation.dto.ts`

**Endpoints:**
- `POST /ai/chat` - Chat with AI tutor (request/response)
- `SSE /ai/chat/stream` - Stream chat response (Server-Sent Events)
- `POST /ai/grammar/check` - Grammar correction & feedback
- `POST /ai/exercises/generate` - Generate language exercises
- `POST /ai/pronunciation/assess` - Assess pronunciation from audio upload
- `POST /ai/conversations` - Start new conversation session
- `GET /ai/conversations/:id/messages` - Get conversation history

**Rate Limiting:** 20 req/min, 100 req/hr (via @nestjs/throttler)

**Entities:**
- `AiConversation` - Chat session metadata
- `AiConversationMessage` - Individual messages (user/assistant/system)

### 5. Subscription Module (`src/modules/subscription/`)

**Purpose:** Cross-platform subscription management via RevenueCat

**Key Components:**
- `subscription.service.ts` - Subscription CRUD, status checks
- `subscription.controller.ts` - User subscription endpoints
- `revenuecat-webhook.controller.ts` - Webhook event processing

**DTOs:** `revenuecat-webhook.dto.ts`

**Endpoints:**
- `GET /subscriptions/me` - Get current subscription status
- `POST /webhooks/revenuecat` - RevenueCat webhook (public, bearer auth)

**Subscription Plans:**
- `free` - Default tier
- `monthly` - Monthly recurring
- `yearly` - Annual recurring
- `lifetime` - One-time purchase

**Subscription Status:**
- `active` - Active subscription
- `trial` - Trial period
- `expired` - Expired subscription
- `cancelled` - Cancelled (may still be active until period end)

**Webhook Events Handled:**
- `INITIAL_PURCHASE` - New subscription created
- `RENEWAL` - Subscription renewed
- `CANCELLATION` - Subscription cancelled
- `EXPIRATION` - Subscription expired
- `PRODUCT_CHANGE` - Plan changed

**Security:** Bearer token validation using `REVENUECAT_WEBHOOK_SECRET`

### 6. Notification Module (`src/modules/notification/`)

**Purpose:** Push notifications via Firebase Cloud Messaging (FCM)

**Key Components:**
- `notification.service.ts` - Device token management
- `firebase.service.ts` - Firebase Admin SDK wrapper
- `notification.controller.ts` - Device registration endpoints

**DTOs:** `register-device-token.dto.ts`

**Endpoints:**
- `POST /notifications/devices` - Register FCM device token
- `DELETE /notifications/devices/:token` - Unregister device

**Device Platforms:**
- `ios` - iOS devices
- `android` - Android devices
- `web` - Web push notifications

**Features:**
- Multi-device support per user
- Automatic token deduplication
- Device name tracking for user management
- Last used timestamp for cleanup

**Entity:** `DeviceToken` - FCM token storage with user relation

## Database Schema

### Entity Relationships

```
User (1) ──< (N) UserLanguage
User (1) ──< (1) Subscription
User (1) ──< (N) DeviceToken
User (1) ──< (N) AiConversation
User (1) ──< (N) RefreshToken
User (1) ──< (N) UserProgress
User (1) ──< (N) UserExerciseAttempt

Language (1) ──< (N) UserLanguage
Language (1) ──< (N) Lesson

Lesson (1) ──< (N) Exercise
Exercise (1) ──< (N) UserExerciseAttempt

AiConversation (1) ──< (N) AiConversationMessage
```

### Table Details

**users**
- PK: `id` (UUID)
- Unique: `email`
- Fields: `password_hash`, `name`, `profile_picture`, `email_verified`, `google_provider_id`, `apple_provider_id`, `created_at`, `updated_at`
- Note: `google_provider_id` and `apple_provider_id` track OAuth account links to prevent duplicates

**refresh_tokens**
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE
- Unique: `token`
- Fields: `device_info`, `expires_at`, `created_at`
- Note: Token format is composite `{uuid}:{hex}` for O(1) PK lookup performance

**languages**
- PK: `id` (UUID)
- Unique: `code` (e.g., 'en', 'es')
- Fields: `name`, `native_name`, `flag_emoji`, `is_active`

**user_languages**
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE, `language_id` → languages(id) CASCADE
- Unique: (user_id, language_id)
- Fields: `proficiency_level` (beginner, intermediate, advanced, native), `started_at`

**subscriptions**
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE
- Unique: `user_id`, `revenuecat_id`
- Fields: `plan`, `status`, `current_period_start`, `current_period_end`, `cancel_at_period_end`

**device_tokens**
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE
- Unique: `token`
- Fields: `platform` (ios, android, web), `device_name`, `last_used_at`

**ai_conversations**
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE
- Fields: `title`, `language`, `session_metadata`, `created_at`, `updated_at`

**ai_conversation_messages**
- PK: `id` (UUID)
- FK: `conversation_id` → ai_conversations(id) CASCADE
- Fields: `role` (user, assistant, system), `content`, `model_used`, `token_count`, `created_at`

**lessons** (future content structure)
- PK: `id` (UUID)
- FK: `language_id` → languages(id) CASCADE
- Fields: `title`, `description`, `difficulty_level`, `order_index`, `is_published`

**exercises** (future content structure)
- PK: `id` (UUID)
- FK: `lesson_id` → lessons(id) CASCADE
- Fields: `type`, `prompt`, `expected_answer`, `points`, `order_index`

**user_progress** (future tracking)
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE, `lesson_id` → lessons(id) CASCADE
- Fields: `status` (not_started, in_progress, completed), `score`, `completed_at`

**user_exercise_attempts** (future tracking)
- PK: `id` (UUID)
- FK: `user_id` → users(id) CASCADE, `exercise_id` → exercises(id) CASCADE
- Fields: `user_answer`, `is_correct`, `points_earned`, `feedback`, `attempted_at`

### Row-Level Security (RLS)

All tables implement Supabase RLS policies:
- Users can only SELECT/UPDATE their own data (WHERE user_id = auth.uid())
- Public access blocked (service role key required for backend)
- Webhook endpoints use service role credentials to bypass RLS
- CASCADE deletion ensures data cleanup on user account removal

## Configuration

### Environment Variables (see .env.example)

**Application:**
- `NODE_ENV` - Environment (development, production)
- `PORT` - Server port (default: 3000)
- `CORS_ALLOWED_ORIGINS` - Comma-separated origins

**Database (Supabase):**
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Anon key (unused, for future client SDK)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (bypasses RLS)

**Authentication:**
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `APPLE_CLIENT_ID`

**Subscriptions (RevenueCat):**
- `REVENUECAT_API_KEY` - REST API key
- `REVENUECAT_WEBHOOK_SECRET` - Webhook authorization secret

**Push Notifications (Firebase):**
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL` - Service account email
- `FIREBASE_PRIVATE_KEY` - Service account private key (with \n escapes)

**AI Services (all optional):**
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY`
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`

**Monitoring (optional):**
- `SENTRY_DSN`

### Validation

Environment validation via Joi schema (`environment-validation-schema.ts`):
- Required variables throw errors on startup
- Type validation (string, number, boolean)
- Default values for optional variables
- Regex validation for secrets (e.g., JWT_SECRET min length)

## Global Middleware & Interceptors

**Applied in main.ts:**

1. **ValidationPipe** (global)
   - `transform: true` - Auto-transform DTOs
   - `whitelist: true` - Strip unknown properties
   - `forbidNonWhitelisted: true` - Throw on unknown properties
   - `enableImplicitConversion: true` - Auto-convert types

2. **ResponseTransformInterceptor** (global)
   - Wraps all responses in BaseResponseDto format:
     ```typescript
     { code: 1, message: "Success", data: {...} }
     ```

3. **AllExceptionsFilter** (global)
   - Catches all exceptions
   - Returns BaseResponseDto with error details:
     ```typescript
     { code: 0, message: "Error message", data: null }
     ```

4. **JwtAuthGuard** (global via APP_GUARD)
   - Protects all endpoints by default
   - Bypass with `@Public()` decorator
   - Extracts user via `@CurrentUser()` decorator

5. **CORS** (configured)
   - Origins from `CORS_ALLOWED_ORIGINS` env var
   - Credentials: true
   - Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS

## API Documentation

**Swagger UI:** Available at `/api/docs` in non-production environments

**Features:**
- Auto-generated from decorators (@ApiTags, @ApiOperation, @ApiResponse)
- Bearer token authentication UI
- Request/response schemas
- DTO validation details

**Setup:** `swagger-documentation-setup.ts` configures DocumentBuilder

## Security Patterns

### Authentication Flow

1. **Registration:**
   - Email/password → bcrypt hash → store in DB
   - Generate JWT access token + refresh token
   - Return tokens to client

2. **Login:**
   - Validate credentials (bcrypt.compare)
   - Generate new token pair
   - Store refresh token with device info

3. **Token Refresh:**
   - Validate refresh token from DB
   - Generate new access token
   - Rotate refresh token (delete old, create new)

4. **OAuth (Google/Apple):**
   - Redirect to provider
   - Validate OAuth token via provider API
   - Find or create user
   - Generate JWT token pair

### Webhook Security

- Bearer token authorization header
- Timing-safe comparison (`crypto.timingSafeEqual`)
- Request body validation via DTOs
- Async processing (responds in <60s)

### Input Validation

All DTOs use class-validator:
```typescript
export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsEnum(['gpt-4', 'claude-sonnet-4', 'gemini-2.0-flash-exp'])
  model?: string;
}
```

## Testing

### Unit Tests

- Framework: Jest
- Location: `*.spec.ts` files next to source
- Coverage: Auth module has comprehensive tests (auth.service.spec.ts)
- Run: `npm run test`

### E2E Tests

- Config: `test/jest-e2e.json`
- Location: `test/` directory
- Run: `npm run test:e2e`

### Test Commands

```bash
npm run test              # Unit tests
npm run test:watch        # Watch mode
npm run test:cov          # Coverage report
npm run test:debug        # Debug mode
npm run test:e2e          # E2E tests
```

## Development Workflow

### Setup

```bash
npm install
cp .env.example .env
# Edit .env with actual credentials
npm run migration:run
npm run start:dev
```

### Database Migrations

```bash
npm run migration:generate -- src/database/migrations/MigrationName  # Generate from entities
npm run migration:run                                                # Apply pending
npm run migration:revert                                             # Rollback last
```

### Code Quality

```bash
npm run lint              # ESLint check + auto-fix
npm run format            # Prettier format
npm run build             # TypeScript build check
```

### Scripts

- `npm run start` - Production mode
- `npm run start:dev` - Development with hot reload
- `npm run start:debug` - Debug mode with inspector
- `npm run start:prod` - Production build execution

## Key Dependencies

**Core Framework:**
- `@nestjs/core`, `@nestjs/common` - NestJS framework
- `@nestjs/config` - Configuration management
- `@nestjs/jwt`, `@nestjs/passport` - Authentication
- `@nestjs/typeorm` - Database ORM
- `@nestjs/swagger` - API documentation
- `@nestjs/throttler` - Rate limiting

**Database:**
- `typeorm` - ORM
- `pg` - PostgreSQL driver
- `@supabase/supabase-js` - Supabase client

**Authentication:**
- `passport`, `passport-jwt` - Auth strategies
- `google-auth-library` - Google ID token verification
- `bcrypt` - Password hashing
- `apple-signin-auth` - Apple OAuth

**AI:**
- `langchain`, `@langchain/core` - LangChain framework
- `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai` - LLM providers
- `openai` - OpenAI SDK
- `langfuse-langchain` - Tracing

**External Services:**
- `firebase-admin` - FCM push notifications
- Revenue Cat integration (HTTP client only, no SDK)

**Validation:**
- `class-validator`, `class-transformer` - DTO validation
- `joi` - Environment validation

## Monitoring & Observability

### Langfuse Tracing

- Tracks all AI requests
- Records: prompt, response, model, tokens, latency
- Accessible via Langfuse dashboard
- Integration: `langfuse-tracing.service.ts`

### Sentry Error Tracking

- Captures uncaught exceptions
- Production error monitoring
- Configuration: `SENTRY_DSN` env var

### Application Logging

- NestJS built-in Logger
- Contextual logging with module names
- Log levels: log, error, warn, debug, verbose

## Deployment Considerations

### Build

```bash
npm run build            # Compiles TypeScript to dist/
npm run start:prod       # Runs built code
```

### Environment

- Node.js 18+ required
- PostgreSQL connection required
- At least one AI provider API key recommended
- Firebase service account for push notifications
- RevenueCat webhook endpoint must be publicly accessible

### Migrations

- Run `npm run migration:run` before starting production server
- Migrations are idempotent (safe to re-run)

### Horizontal Scaling

- Stateless design (no in-memory session storage)
- Database connection pooling via TypeORM
- Refresh tokens stored in DB (multi-instance safe)
- No shared file storage (use Supabase Storage for uploads)

## Future Enhancements

- Rate limiting per user (currently per IP via @nestjs/throttler)
- Redis caching layer for frequently accessed data
- Background job processing (Bull/BullMQ) for async tasks
- Email notification service (SendGrid/Mailgun)
- Admin dashboard for user management
- Analytics tracking and reporting
- Real-time features via WebSocket
- GraphQL API alongside REST
