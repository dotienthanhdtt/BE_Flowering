# Codebase Scout & Documentation Audit Report

**Date:** 2026-02-23
**Project:** AI Language Learning Backend (be_flowering)
**All docs last updated:** 2026-02-04 (19 days stale)

---

## Part A: Codebase Structure Summary

### Root Configuration

**package.json** - NestJS 11.0, TypeScript 5.7, 30 prod deps, 16 dev deps
- Key frameworks: NestJS 11 (core, config, jwt, passport, swagger, throttler, typeorm)
- AI: LangChain suite (@langchain/openai, @langchain/anthropic, @langchain/google-genai, langfuse-langchain)
- External: firebase-admin, @supabase/supabase-js, apple-signin-auth
- DB: TypeORM 0.3.28, pg 8.18
- Auth: passport, passport-jwt, passport-google-oauth20, bcrypt 6.0

**tsconfig.json** - strict mode ON (noImplicitAny, strictNullChecks, strictPropertyInitialization, noUnusedLocals/Params)
- Path aliases: `@/*` -> `src/*`, `@common/*` -> `src/common/*`, `@config/*` -> `src/config/*`
- Target: ES2022, CommonJS module

**.env.example** - 16 env var groups: App (3), DB/Supabase (4), Auth/JWT (3), OAuth Google (3), OAuth Apple (1), RevenueCat (2), Firebase (3), AI (3), Langfuse (3), Sentry (1), Monitoring (1)

### Modules (6 total, in `src/modules/`)

| Module | Controller | Service(s) | DTOs | Key Files |
|--------|-----------|------------|------|-----------|
| **auth** | auth.controller.ts | auth.service.ts | register, login, auth-response, refresh-token, apple-auth | strategies/(jwt, google, apple), guards/(jwt-auth, google-auth), decorators/current-user, 2 spec files |
| **ai** | ai.controller.ts | learning-agent, unified-llm, prompt-loader, langfuse-tracing, whisper-transcription | chat, grammar-check, generate-exercise, pronunciation-assessment | providers/(openai-llm, anthropic-llm, gemini-llm, llm-models.enum, llm-provider.interface), guards/ai-rate-limit, prompts/(tutor-system, grammar-check, exercise-generator, pronunciation-assessment).md |
| **user** | user.controller.ts | user.service.ts | user-profile, update-user | - |
| **language** | language.controller.ts | language.service.ts | language, user-language, add-user-language, update-user-language | - |
| **subscription** | subscription.controller.ts + webhooks/revenuecat-webhook.controller.ts | subscription.service.ts | subscription, revenuecat-webhook | - |
| **notification** | notification.controller.ts | notification.service.ts, firebase.service.ts | register-device, send-notification | - |

### Entities (12 in database.module.ts, 13 files in entities/)

| Entity | Table | Key Fields | Relations |
|--------|-------|-----------|-----------|
| User | users | email, passwordHash?, authProvider?, providerId?, displayName?, avatarUrl?, nativeLanguageId? | ManyToOne Language |
| Language | languages | code, name, nativeName?, isActive, flagUrl? | - |
| UserLanguage | user_languages | userId, languageId, proficiencyLevel (enum: beginner/elementary/intermediate/upper_intermediate/advanced), isActive | ManyToOne User, ManyToOne Language |
| Lesson | lessons | (future) | ManyToOne Language |
| Exercise | exercises | (future) | ManyToOne Lesson |
| UserProgress | user_progress | (future) | ManyToOne User, ManyToOne Lesson |
| UserExerciseAttempt | user_exercise_attempts | (future) | ManyToOne User, ManyToOne Exercise |
| Subscription | subscriptions | userId (unique), plan (enum), status (enum), revenuecatId?, currentPeriodStart/End?, cancelAtPeriodEnd | ManyToOne User (CASCADE) |
| AiConversation | ai_conversations | userId, languageId, title?, topic?, messageCount, metadata? (jsonb) | ManyToOne User (CASCADE), ManyToOne Language |
| AiConversationMessage | ai_conversation_messages | conversationId, role (enum: user/assistant/system), content, audioUrl?, metadata? (jsonb) | ManyToOne AiConversation (CASCADE) |
| DeviceToken | device_tokens | userId, fcmToken (unique), platform (enum), deviceName?, isActive | ManyToOne User (CASCADE) |
| RefreshToken | refresh_tokens | tokenHash (indexed), userId, expiresAt, revoked | ManyToOne User (CASCADE) |

**Note:** entities/index.ts exports 11 entities (missing RefreshToken export!), but database.module.ts registers all 12.

### Common (`src/common/`)

| File | Purpose |
|------|---------|
| dto/base-response.dto.ts | `BaseResponseDto<T>` with `{code, message, data}` pattern; static `success()` and `error()` methods |
| interceptors/response-transform.interceptor.ts | Auto-wraps responses into BaseResponseDto (skips if already wrapped) |
| filters/all-exceptions.filter.ts | Global catch-all: HTTP exceptions + generic errors -> BaseResponseDto.error() |
| decorators/public-route.decorator.ts | `@Public()` sets `isPublic` metadata to bypass global JWT guard |
| index.ts | Re-exports all 4 above |

**Missing from common/**: No `pagination.dto.ts` found despite codebase-summary doc mentioning it. No guards directory with actual guards (guards are in auth module).

### Config (`src/config/`)

| File | Purpose |
|------|---------|
| app-configuration.ts | `AppConfiguration` interface + factory: nodeEnv, port, corsOrigins, database, jwt, oauth(google/apple), ai, sentry, revenuecat, firebase |
| environment-validation-schema.ts | Joi schema: DATABASE_URL/SUPABASE required; JWT_SECRET required (min 32); AI/Firebase/RevenueCat all optional |

**Notable:** JWT default expiry in app-configuration.ts is `'30d'`, NOT `'7d'` as stated in docs and .env.example.

### Database Infrastructure

- `database.module.ts` - TypeORM async config, 12 entities, SSL, pool (max:10, min:2)
- `supabase-storage.service.ts` - Supabase client wrapper
- `typeorm-data-source.ts` - Migration CLI data source
- 4 migrations: initial-schema, rls-policies, add-flag-url-to-languages, create-refresh-tokens-table
- `seeds/language-seed-data.ts` - Language seeding

### Swagger

- `src/swagger/swagger-documentation-setup.ts` - Swagger config at `/api/docs`

### AI Endpoints (Actual from code)

| Endpoint | Method | Auth |
|----------|--------|------|
| `/ai/chat` | POST | JWT |
| `/ai/chat/stream` | SSE | JWT |
| `/ai/grammar/check` | POST | JWT |
| `/ai/exercises/generate` | POST | JWT |
| `/ai/pronunciation/assess` | POST (multipart) | JWT |
| `/ai/conversations` | POST | JWT |
| `/ai/conversations/:id/messages` | GET | JWT |

### Auth Endpoints (Actual from code)

| Endpoint | Method | Auth |
|----------|--------|------|
| `/auth/register` | POST | Public |
| `/auth/login` | POST | Public |
| `/auth/google` | GET | Public (GoogleAuthGuard) |
| `/auth/google/callback` | GET | Public (GoogleAuthGuard) |
| `/auth/apple` | POST | Public |
| `/auth/refresh` | POST | Public |
| `/auth/logout` | POST | JWT |

### Language Endpoints (Actual from code)

| Endpoint | Method | Auth |
|----------|--------|------|
| `/languages` | GET | Public |
| `/languages/user` | GET | JWT |
| `/languages/user` | POST | JWT |
| `/languages/user/:languageId` | PATCH | JWT |
| `/languages/user/:languageId` | DELETE | JWT |

### LLM Models (Actual from code - 10 total)

- OpenAI: gpt-4o, gpt-4o-mini, o1-preview, o1-mini
- Anthropic: claude-3-5-sonnet-20241022, claude-3-haiku-20240307
- Gemini: gemini-2.5-flash-preview-05-20, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash

---

## Part B: Documentation Status & Issues

### 1. `docs/code-standards.md` (970 lines)

**Content:** Comprehensive guide covering project structure, naming conventions, module/controller/service patterns, TypeScript patterns, DTOs, entities, auth, config, logging, Swagger, testing, security, import organization, performance, comments, version control, deprecated patterns.

**Issues:**
- Directory tree shows `supabase.service.ts` but actual file is `supabase-storage.service.ts`
- Tree mentions `common/guards/` as having "[deprecated guards]" - misleading, no guards exist there at all
- Tree does not show `common/dto/` or `pagination.dto.ts`
- Config example snippet only shows `revenuecat` and `firebase` sections; actual `AppConfiguration` has 8 top-level sections
- Mentions `@CurrentUser` in `common/decorators/` but actual location is `modules/auth/decorators/` (common only has `public-route.decorator.ts`)
- Entity pattern example uses `SubscriptionEntity` class name, but actual code uses `Subscription`

### 2. `docs/api-documentation.md` (838 lines)

**Content:** Detailed REST API reference with request/response examples, error codes, cURL examples, SDK examples (JS, Python, Swift, Kotlin), webhook security, CORS config.

**Issues -- MAJOR DISCREPANCIES:**
- **Response format wrong.** Doc shows `{data, statusCode}` and error format `{statusCode, message, error}`. Actual format is `{code: 1, message, data}` (BaseResponseDto). This is fundamentally incorrect.
- **Auth endpoint names wrong.** Doc uses `POST /auth/signup` but actual code is `POST /auth/register`.
- **User entity fields wrong.** Doc shows `name`, `profilePicture`, `emailVerified` fields. Actual User entity has `displayName`, `avatarUrl`, and NO `emailVerified` field.
- **Missing auth endpoints.** Doc omits `POST /auth/refresh` and `POST /auth/logout`.
- **AI endpoints outdated.** Doc lists `POST /ai/conversation`, `POST /ai/vocabulary/explain`, `POST /ai/translate`. Actual endpoints: `POST /ai/chat`, `SSE /ai/chat/stream`, `POST /ai/grammar/check`, `POST /ai/exercises/generate`, `POST /ai/pronunciation/assess`, `POST /ai/conversations`, `GET /ai/conversations/:id/messages`. Vocabulary explain and translate do NOT exist.
- **Language endpoints wrong route prefix.** Doc uses `/language` but actual code uses `/languages` (plural).
- **Rate limiting section says "Not implemented"** but ThrottlerGuard IS applied on AI controller + AiRateLimitGuard exists.
- **Pagination section says "Not implemented"** - accurate, no pagination.dto found.
- **Google OAuth flow wrong.** Doc shows `POST /auth/google` with `{token}` body. Actual is `GET /auth/google` (redirect flow) + `GET /auth/google/callback`.

### 3. `docs/codebase-summary.md` (659 lines)

**Content:** High-level overview with tech stack, project structure, module details, database schema, configuration, middleware, security, testing, deployment.

**Issues:**
- **Entity count.** Says "12 TypeORM entities" but there are 12 entity classes + 13 entity files. The entities/index.ts only exports 11 (RefreshToken not exported). The 12 count is technically correct for registered entities.
- **Common directory tree.** Shows `pagination.dto.ts` which does NOT exist.
- **Common directory tree.** Shows `guards/` with "[deprecated guards]" - directory does not exist.
- **AI models listed.** Lists gpt-4, gpt-4-turbo, gpt-3.5-turbo, claude-sonnet-4-20250514, claude-opus-4, claude-haiku-3-5, gemini-2.0-flash-exp, gemini-1.5-pro, gemini-1.5-flash, gemini-1.0-pro. Actual code: gpt-4o, gpt-4o-mini, o1-preview, o1-mini, claude-3-5-sonnet-20241022, claude-3-haiku-20240307, gemini-2.5-flash-preview-05-20, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash. **ALL 10 model names are wrong or different.**
- **AI DTOs listed wrong.** Says `chat-request.dto.ts`, `create-conversation.dto.ts`. Actual files: `chat.dto.ts` (contains both request and response DTOs), and CreateConversationDto is likely in chat.dto.ts.
- **Auth DTOs.** Lists `register.dto.ts` as correct (matches code).
- **Auth endpoints.** Lists `POST /auth/register` correctly. But also lists `POST /auth/refresh` and `POST /auth/logout` which is correct.
- **Language controller route.** Says `GET /language` but actual is `GET /languages`.
- **Supabase file name.** Lists `supabase-storage.service.ts` correctly in the tree.
- **User entity fields.** Table says `password_hash`, `name`, `profile_picture`, `email_verified`. Actual: `password_hash`, `display_name`, `avatar_url`, `auth_provider`, `provider_id`, `native_language_id`. **Missing auth_provider, provider_id, native_language_id. Fields name and profile_picture do not exist.**
- **Language entity fields.** Says `flag_emoji`. Actual field is `flag_url`. No `flag_emoji` exists.
- **RefreshToken fields.** Says `token`, `device_info`, `expires_at`. Actual: `token_hash` (not `token`), no `device_info` field, has `revoked` boolean.
- **DeviceToken fields.** Says `token`. Actual column name: `fcm_token`.
- **AiConversation fields.** Says `session_metadata`. Actual has `topic`, `message_count`, `metadata` (jsonb). Different field names.
- **AiConversationMessage fields.** Says `model_used`, `token_count`. Actual has `audio_url`, `metadata` (jsonb). **model_used and token_count do not exist.**
- **UserLanguage proficiency levels.** Doc says `beginner, intermediate, advanced, native`. Actual enum: `beginner, elementary, intermediate, upper_intermediate, advanced`. Different set.
- **Seed file not mentioned.** `database/seeds/language-seed-data.ts` exists but not in docs.
- **Migration count.** Doc shows 1 migration. Actual: 4 migrations.

### 4. `docs/system-architecture.md` (593 lines)

**Content:** Architecture layers, design patterns, module diagrams, DB schema, security flows, external integrations, scalability, monitoring, deployment, technology decisions.

**Issues:**
- **AI controller endpoints in diagram wrong.** Shows `POST /ai/conversation`, `POST /ai/vocabulary/explain`, `POST /ai/grammar/check`, `POST /ai/translate`. Actual: `POST /ai/chat`, `SSE /ai/chat/stream`, `POST /ai/grammar/check`, `POST /ai/exercises/generate`, `POST /ai/pronunciation/assess`, `POST /ai/conversations`, `GET /ai/conversations/:id/messages`.
- **Auth controller diagram.** Shows `POST /auth/signup` and `POST /auth/login` and `POST /auth/google` and `POST /auth/apple`. Actual: `POST /auth/register` (not signup), Google uses GET redirect flow.
- **Response format in "API Design Principles".** Shows `{data, message, statusCode}` and error `{statusCode, message, error}`. Actual: `{code: 1, message, data}`.
- **Rate limiting constraint.** Says "No rate limiting" in limitations. But ThrottlerGuard IS applied on AI controller.
- **DB entity diagram.** Only shows User, Subscription, DeviceToken relationships. Missing Language, UserLanguage, AI entities, etc.

### 5. `docs/project-overview-pdr.md` (523 lines)

**Content:** Executive summary, product vision, core features, tech stack, functional/non-functional requirements, API endpoints list, data models, security, success metrics, risk assessment, deployment strategy, future enhancements.

**Issues:**
- **NestJS version.** Says "NestJS 10.x". Actual: NestJS 11.0 (package.json has `@nestjs/common: ^11.0.0`).
- **Auth endpoints.** Lists `POST /auth/signup`, `POST /auth/reset-password`, `POST /auth/verify-email`. Actual has `POST /auth/register` (not signup). Reset-password and verify-email endpoints DO NOT EXIST in code.
- **User endpoints.** Lists `GET /users/me/preferences` which DOES NOT EXIST.
- **AI endpoints outdated.** Same issues as api-documentation.md. Lists vocabulary/explain and translate which don't exist.
- **User data model fields.** Same issues: `name` and `profile_picture` and `email_verified` fields don't match actual code.
- **NotificationDevice model.** Lists `token` field. Actual column: `fcm_token`. Missing `is_active` field.
- **Email verification mentioned** as core feature and acceptance criteria, but NO email verification implementation exists.
- **Password reset mentioned** but NO implementation exists.
- **DB command.** Lists `npm run migration:create` but scripts only have `migration:run`, `migration:revert`, `migration:generate`.

### 6. `docs/project-roadmap.md` (319 lines)

**Content:** 4-phase roadmap (MVP Foundation -> Production Hardening -> Content & Analytics -> Scalability & Advanced), sprint details, risk management, success criteria.

**Issues:**
- **Phase 2 progress stale.** Says "15%" progress from Feb 4. No updates since then despite 19 days passing. Sprint tasks dated "Week of 2026-02-03" are outdated.
- **Entity count.** Says "12 database entities with RLS" - the 12 count is correct for registered entities.
- **Model count.** Says "10 AI models supported" - count matches but model names differ from code.
- **Test coverage.** Phase 2 target "Unit test coverage >80%" at 15%. Only 2 spec files found: `auth.controller.spec.ts` and `auth.service.spec.ts`.

---

## Part C: Critical Discrepancies Summary

### HIGH PRIORITY (Functional Inaccuracy)

1. **Response format mismatch.** All docs describe wrong response format. Actual: `{code: 1, message, data}` via BaseResponseDto. Docs variously say `{data, statusCode}` or `{statusCode, message, error}`.

2. **User entity fields completely wrong in docs.** Docs say `name`, `profile_picture`, `email_verified`. Actual: `displayName`, `avatarUrl`, `authProvider`, `providerId`, `nativeLanguageId`. No `emailVerified` field exists.

3. **AI endpoints drastically changed.** Docs list endpoints that don't exist (vocabulary/explain, translate). Missing real endpoints (chat/stream SSE, exercises/generate, pronunciation/assess, conversations CRUD).

4. **AI model names all wrong.** Docs list obsolete names (gpt-4, claude-sonnet-4, gemini-2.0-flash-exp). Actual: gpt-4o, gpt-4o-mini, o1-preview, o1-mini, claude-3-5-sonnet, claude-3-haiku, gemini-2.5-flash-preview, etc.

5. **Auth endpoint naming.** Docs say `/auth/signup`, code says `/auth/register`. Google OAuth is GET redirect, not POST with token body.

6. **Language route prefix.** Docs say `/language`, code uses `/languages`.

7. **JWT default expiry mismatch.** Code default is `30d`, docs and .env.example say `7d`.

### MEDIUM PRIORITY (Missing/Phantom Features)

8. **Phantom features.** Email verification, password reset, `GET /users/me/preferences` documented but NOT implemented.

9. **Rate limiting documented as "not implemented"** but IS implemented (ThrottlerGuard on AI + AiRateLimitGuard).

10. **Phantom common/ files.** `pagination.dto.ts` and `guards/` directory mentioned in docs but don't exist in common/.

11. **RefreshToken entity fields wrong.** Doc says `token`, `device_info`. Actual: `token_hash`, `revoked`. No `device_info`.

12. **DeviceToken column name.** Doc says `token`, actual is `fcm_token`.

13. **AiConversationMessage fields wrong.** Doc says `model_used`, `token_count`. Actual has `audio_url`, `metadata`. No model_used or token_count.

14. **UserLanguage proficiency levels wrong.** Doc lists 4 levels (beginner/intermediate/advanced/native). Actual enum has 5 (beginner/elementary/intermediate/upper_intermediate/advanced).

### LOW PRIORITY (Minor Inconsistencies)

15. **NestJS version.** PDR says 10.x, actual is 11.0.

16. **entities/index.ts missing RefreshToken export.**

17. **Migration count.** Docs show 1, actual is 4.

18. **Supabase service file name.** Code-standards.md says `supabase.service.ts`, actual is `supabase-storage.service.ts`.

19. **Language entity field.** Codebase-summary says `flag_emoji`, actual is `flag_url`.

20. **@CurrentUser decorator location.** Code-standards says `common/decorators/`, actual location is `modules/auth/decorators/`.

---

## Unresolved Questions

1. Was `pagination.dto.ts` removed intentionally or never created?
2. Were email verification and password reset deliberately deferred or accidentally documented?
3. Are the AI model names in docs from an earlier version, or were docs written speculatively?
4. Should the JWT default expiry be 7d (as documented) or 30d (as coded)?
5. Is the `send-notification.dto.ts` file used anywhere? (Found in notification module but not referenced in controller.)
