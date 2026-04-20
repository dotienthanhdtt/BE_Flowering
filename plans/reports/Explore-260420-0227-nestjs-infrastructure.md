# NestJS Backend Infrastructure Scout

## 1. src/common/ — Infrastructure Components

| File | Purpose |
|------|---------|
| **Decorators** | |
| `optional-auth.decorator.ts` | Marks routes that don't require authentication |
| `public-route.decorator.ts` | Marks routes as public (bypass JWT guard) |
| `require-premium.decorator.ts` | Enforces premium subscription requirement |
| `active-language.decorator.ts` | Injects active user language context |
| **Filters** | |
| `all-exceptions.filter.ts` | Global error handler; catches all exceptions, formats with BaseResponseDto, reports to Sentry |
| **Interceptors** | |
| `response-transform.interceptor.ts` | Wraps all responses in BaseResponseDto, converts response data to snake_case |
| **Middleware** | |
| `http-logger.middleware.ts` | Logs all HTTP requests |
| `snake-to-camel-case.middleware.ts` | Converts incoming snake_case query params/body to camelCase (excluded: subscription/webhook) |
| **Guards** | |
| `admin.guard.ts` | Checks `is_admin` flag on user entity; tested |
| `premium.guard.ts` | Verifies active premium subscription |
| `language-context.guard.ts` | Enforces language context resolution; tested |
| **Services** | |
| `firebase-admin.service.ts` | Firebase Admin SDK initialization and operations |
| `language-context-cache.service.ts` | Caches language context per user to reduce DB queries |
| **DTOs & Utils** | |
| `base-response.dto.ts` | Standard API response wrapper (success/error format) |
| `case-converter.ts` | Utility functions for snake_case ↔ camelCase conversion |
| `language-context.module.ts` | Lazy-loaded module for language context logic |

---

## 2. src/config/ — Configuration Files & Environment Variables

| File | Responsibility |
|------|-----------------|
| `app-configuration.ts` | Loads all env vars into typed config object; exports interface with properties for: nodeEnv, port, corsOrigins, smtp, database, jwt, ai services (OpenAI, Anthropic, Google AI, Langfuse), sentry, revenuecat, firebase |
| `environment-validation-schema.ts` | Joi validation schema; enforces required fields (DATABASE_URL, JWT_SECRET, REVENUECAT_WEBHOOK_SECRET) and optional fields with defaults |

**Environment Variables by Category:**
- **App**: NODE_ENV, PORT, CORS_ALLOWED_ORIGINS
- **Database**: DATABASE_URL (Supabase PostgreSQL), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- **Email/SMTP**: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
- **Auth**: JWT_SECRET (min 32 chars), JWT_EXPIRES_IN (default 7d)
- **AI**: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST, STT_PROVIDER
- **Monitoring**: SENTRY_DSN
- **RevenueCat**: REVENUECAT_API_KEY, REVENUECAT_WEBHOOK_SECRET (required)
- **Firebase**: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

---

## 3. src/database/ — Data Layer

### Data Source & Configuration
- **typeorm-data-source.ts**: PostgreSQL (Supabase), SSL enabled, entities glob pattern, migrations pattern, synchronize disabled

### Entities (20 total)
1. User
2. UserLanguage
3. Language
4. Subscription
5. RefreshToken
6. DeviceToken
7. PasswordReset
8. AiConversation
9. AiConversationMessage
10. Exercise
11. Lesson
12. UserProgress
13. UserExerciseAttempt
14. Vocabulary
15. Scenario
16. ScenarioCategory
17. UserScenarioAccess
18. WebhookEvent
19. AccessTier (enum)
20. ContentStatus (enum)

### Migrations (30 total; 5 most recent)
| Migration | Purpose |
|-----------|---------|
| `1777000500000-add-status-to-content-tables` | Creates `content_status` enum (draft, published, archived); adds status column to lessons, exercises, scenarios with published default |
| `1777000600000-add-is-admin-to-users` | Adds `is_admin` boolean to users table (default false) |
| `1777001000000-refactor-content-access-tier` | Creates `access_tier` enum (free, premium); adds access_tier to scenarios and lessons; backfills from legacy is_premium flags; updates status based on is_active |
| `1777000400000-backfill-and-enforce-ai-conversation-language-id` | Backfills language_id on ai_conversations from related scenario; adds NOT NULL constraint |
| `1777000300000-backfill-and-enforce-scenario-language-id` | Backfills language_id on scenarios; adds NOT NULL constraint |

### Seeds
- `language-seed-data.ts` — Bootstrap languages
- `scenario-seed-data.ts` — Bootstrap scenarios

### Supabase Storage
- `supabase-storage.service.ts` — File upload/download via Supabase Storage bucket

---

## 4. Root-Level Bootstrap Files

### src/main.ts
- **Global Validation Pipe**: Transform, whitelist, forbid non-whitelisted, implicit conversion enabled
- **Global Interceptor**: ResponseTransformInterceptor (wraps all responses, converts to snake_case)
- **Global Filter**: AllExceptionsFilter (catches all exceptions, formats error responses, reports to Sentry)
- **CORS**: Configured from env var `CORS_ALLOWED_ORIGINS`, allows credentials, methods: GET/POST/PUT/PATCH/DELETE/OPTIONS
- **Swagger**: Auto-setup in non-production; docs at `/api/docs`
- **Graceful Shutdown**: Flushes Langfuse traces on SIGTERM
- **Binding**: 0.0.0.0 (IPv4 for Railway/Docker)

### src/app.module.ts
- **Global Guards** (via APP_GUARD provider):
  - JwtAuthGuard — Enforces JWT on all routes (can bypass with @PublicRoute decorator)
  - LanguageContextGuard — Resolves language context (validates language_id header/param)
- **Global Middleware**:
  - HttpLoggerMiddleware — Logs all requests
  - SnakeToCamelCaseMiddleware — Converts snake_case to camelCase (excludes subscription/webhook routes)
- **Imports**: ConfigModule (global), DatabaseModule, LanguageContextModule, 8+ feature modules (Auth, AI, User, Language, Subscription, Onboarding, Lesson, Scenario, Vocabulary, Progress, AdminContent)

---

## 5. package.json — Dependencies

### NestJS Ecosystem (v11)
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/typeorm`

### Database & ORM
- `typeorm` ^0.3.28
- `pg` ^8.18.0 (PostgreSQL driver)

### Authentication
- `passport`, `passport-jwt`, `passport-google-oauth20`
- `bcrypt` ^6.0.0
- `jsonwebtoken` (via @nestjs/jwt)

### LLM & AI
- `@langchain/anthropic` ^1.3.13 (Claude)
- `@langchain/openai` ^1.2.4 (GPT)
- `@langchain/google-genai` ^2.1.24 (Gemini)
- `langchain` ^1.2.16
- `openai` ^4.104.0

### Observability & Monitoring
- `@langfuse/langchain` ^5.0.1 (LLM tracing)
- `@langfuse/otel` ^5.0.1 (OpenTelemetry integration)
- `langfuse` ^3.38.6 (SDK)
- `@sentry/node` ^10.46.0 (Error tracking)
- `@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`

### Firebase & Cloud
- `firebase-admin` ^13.6.0
- `@supabase/supabase-js` ^2.93.3

### Email
- `nodemailer` ^8.0.1

### Validation & Utilities
- `joi` ^17.13.3
- `class-validator` ^0.14.1
- `class-transformer` ^0.5.1
- `rxjs` ^7.8.1
- `reflect-metadata` ^0.2.2
- `dotenv` ^17.2.3

### DevDependencies
Jest (unit/integration testing), TypeScript 5.7.2, ESLint 9.x, Prettier, ts-jest, ts-loader, ts-node

---

## 6. Testing

**22 .spec.ts files across codebase:**
- Common: admin.guard.spec.ts, language-context.guard.spec.ts
- Modules:
  - Auth: auth.service.spec.ts, auth.controller.spec.ts
  - AI: transcription.service.spec.ts, learning-agent-correction.service.spec.ts, translation.service.spec.ts, openai-stt.provider.spec.ts, gemini-stt.provider.spec.ts
  - Admin: admin-content.service.spec.ts
  - Language: language.service.spec.ts
  - Lesson: lesson.service.spec.ts
  - Onboarding: onboarding.service.spec.ts, onboarding.controller.spec.ts, onboarding-chat.dto.spec.ts
  - Scenario: scenario-chat.service.spec.ts, scenario-access.service.spec.ts, scenario-chat.controller.spec.ts
  - Vocabulary: vocabulary.service.spec.ts, vocabulary-review.service.spec.ts, review-session-store.spec.ts, leitner.spec.ts

**Jest configured**: test regex `.*\.spec\.ts$`, module name mapper for @/, @common/, @config/ aliases, coverage directory `../coverage`

