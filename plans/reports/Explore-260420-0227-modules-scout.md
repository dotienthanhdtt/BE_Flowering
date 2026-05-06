# NestJS Backend Feature Modules Scout

**Project:** Flowering Language Learning Backend  
**Date:** 2026-04-20  
**Scope:** Module architecture, entry points, routes, DTOs, external dependencies

---

## Module Overview

### 1. **Auth Module** (`/auth`)
**Purpose:** Firebase-based authentication, JWT token management, OAuth token refresh

**Files:**
- `auth.controller.ts` – Login/register/logout endpoints
- `auth.service.ts` – Firebase auth, JWT token lifecycle
- `strategies/` – JWT & Firebase strategies
- `guards/` – Auth guards
- `dto/` – Auth request/response DTOs

**Public Routes:**
- `POST /auth/firebase` – Sign in with Firebase (Google/Apple)
- `POST /auth/refresh` – Refresh access token
- `POST /auth/register`, `/login`, `/forgot-password` – **Disabled (410 Gone)**

**Protected Routes:**
- `POST /auth/logout` – Invalidate refresh tokens

**Key Dependencies:**
- **Firebase Auth** – Firebase token verification & user creation
- **JWT** – Token signing/verification
- **Bcrypt** – Password hashing (legacy, not used in current flow)
- **Email Service** – OTP delivery (disabled endpoints)

**Entities Used:**
- `User`, `RefreshToken`, `AiConversation`, `PasswordReset`, `UserLanguage`

**Key Pattern:** Unified Firebase endpoint; email/password auth soft-disabled via HTTP 410.

---

### 2. **User Module** (`/user`)
**Purpose:** User profile management

**Files:**
- `user.controller.ts` – Profile endpoints
- `user.service.ts` – Profile fetch/update
- `dto/` – `UserProfileDto`, `UpdateUserDto`

**Protected Routes:**
- `GET /users/me` – Get current user profile
- `PATCH /users/me` – Update profile

**Entities Used:**
- `User`

**Key Pattern:** Minimal profile CRUD; skips language context decorator.

---

### 3. **Language Module** (`/language`)
**Purpose:** Manage available languages and user language selections

**Files:**
- `language.controller.ts` – Language endpoints
- `language.service.ts` – Language CRUD
- `dto/` – Language, UserLanguage, AddUserLanguage DTOs

**Public Routes:**
- `GET /languages` – List all languages (optional type filter: `native`/`learning`)

**Protected Routes:**
- `GET /languages/user` – Get user's learning languages
- `POST /languages/user` – Add language to learning list
- `PATCH /languages/user/native` – Set native language
- `PATCH /languages/user/:languageId` – Update proficiency
- `DELETE /languages/user/:languageId` – Remove language

**Entities Used:**
- `Language`, `UserLanguage`

**Key Pattern:** Dual language system (native + learning); required for context in other endpoints.

---

### 4. **Subscription Module** (`/subscription`)
**Purpose:** Subscription lifecycle, RevenueCat webhook integration

**Files:**
- `subscription.controller.ts` – Subscription query
- `subscription.service.ts` – Subscription management
- `webhooks/revenuecat-webhook.controller.ts` – Webhook handler
- `dto/` – Subscription, RevenueCat DTOs

**Protected Routes:**
- `GET /subscriptions/me` – Get user subscription status

**Public Webhook:**
- `POST /webhooks/revenuecat` – RevenueCat subscription events (signature-verified)

**External Service:**
- **RevenueCat** – IAP webhook for subscription lifecycle (INITIAL_PURCHASE, RENEWAL, CANCELLATION, etc.)

**Entities Used:**
- `Subscription`, `WebhookEvent`

**Key Pattern:** DB-based idempotency for webhook events; sandbox event filtering in production.

---

### 5. **AI Module** (`/ai`)
**Purpose:** LLM chat, translation, transcription, Langfuse observability

**Files:**
- `ai.controller.ts` – Chat, translate, transcribe endpoints
- `services/` – LearningAgent, Translation, Transcription, Langfuse tracing
- `providers/` – LLM providers (OpenAI, Anthropic, Gemini), STT providers
- `dto/` – Chat, translation, transcription DTOs
- `guards/` – Rate limit guard
- `prompts/` – Prompt templates (loaded at module init)

**Protected Routes (Premium-Only by Default):**
- `POST /ai/chat` – Chat with AI tutor
- `SSE /ai/chat/stream` – Stream chat response

**Semi-Public Routes (Optional Auth, Rate-Limited):**
- `POST /ai/chat/correct` – Grammar/vocabulary check (5 req/min, no premium required)
- `POST /ai/translate` – Translate word or sentence (5 req/min)

**Protected Routes:**
- `POST /ai/transcribe` – Audio-to-text (multipart/form-data, 10MB limit)

**External Services:**
- **LLM Providers** – OpenAI, Anthropic, Gemini
- **Langfuse** – Hierarchical observability (conversation spans → child generations)
- **STT Providers** – OpenAI, Gemini

**Entities Used:**
- `AiConversation`, `AiConversationMessage`, `Vocabulary`

**Rate Limiting:**
- `ai-short`: 20 req/min
- `ai-medium`: 100 req/hour

**Key Pattern:** Unified LLM selection via `UnifiedLLMService`; Langfuse span caching per conversation (30-min TTL); SSE streaming for real-time responses.

---

### 6. **Lesson Module** (`/lesson`)
**Purpose:** Fetch home screen lessons grouped by category, auto-enroll user in language

**Files:**
- `lesson.controller.ts`
- `lesson.service.ts`
- `dto/` – Lesson query/response DTOs

**Protected Routes:**
- `GET /lessons` – Get lessons (requires X-Learning-Language header; auto-enrolls if missing)

**Entities Used:**
- `Lesson`, `UserLanguage` (via auto-enrollment)

**Key Pattern:** Requires active learning language; auto-enrolls user if needed; decorated with `@AutoEnrollLanguage()`.

---

### 7. **Scenario Module** (`/scenario` via ScenarioChatModule)
**Purpose:** Roleplay conversation scenarios with AI, access control, conversation transcript

**Files:**
- `scenario-chat.controller.ts`
- `services/scenario-chat.service.ts` – Chat logic
- `services/scenario-access.service.ts` – Premium + Scenario availability checks
- `dto/` – Scenario chat request/response DTOs

**Protected Routes (Premium-Only):**
- `POST /scenario/chat` – Send scenario chat turn
  - Rate limits: 20 req/min (short), 100 req/hour (medium)
  - Body: `ScenarioChatRequestDto` (scenario ID, message, optional conversationId, forceNew)
  - Response: `ScenarioChatResponseDto` (AI reply, turn number, isCompleted)

- `GET /scenario/:scenarioId/conversations` – List past conversations for scenario
  - Response: `ScenarioConversationListResponseDto`

- `GET /scenario/conversations/:id` – Get transcript (owner-only)
  - Response: `ScenarioConversationDetailDto`

**Entities Used:**
- `AiConversation`, `AiConversationMessage`, `Scenario`, `UserScenarioAccess`

**Dependencies:**
- `AiModule` – LLM integration
- `SubscriptionModule` – Premium guard
- `LanguageModule` – Active language context

**Key Pattern:** Scenario access gating (premium + scenario availability); conversation state machine (forceNew vs. continue).

---

### 8. **Vocabulary Module** (`/vocabulary`)
**Purpose:** Vocabulary list management + Leitner SRS review sessions

**Files:**
- `vocabulary.controller.ts` – List, get, delete endpoints
- `vocabulary-review.controller.ts` – Review session endpoints
- `services/vocabulary.service.ts` – CRUD
- `services/vocabulary-review.service.ts` – Leitner algorithm
- `services/review-session-store.ts` – In-memory session cache
- `dto/` – Vocabulary query/response DTOs

**Protected Routes:**
- `GET /vocabulary` – List user vocabulary (filters: status, due date, language)
- `GET /vocabulary/:id` – Get single item
- `DELETE /vocabulary/:id` – Remove vocabulary

**Review Endpoints:**
- `POST /vocabulary/review/start` – Begin Leitner review session
- `POST /vocabulary/review/:sessionId/answer` – Submit answer
- `GET /vocabulary/review/:sessionId/status` – Check session status

**Entities Used:**
- `Vocabulary`

**Key Pattern:** Session store (in-memory); Leitner box-based SRS (spaced repetition).

---

### 9. **Onboarding Module** (`/onboarding`)
**Purpose:** Pre-login conversational onboarding with AI; profile extraction; rate-limited

**Files:**
- `onboarding.controller.ts`
- `onboarding.service.ts` – Chat logic, profile extraction
- `onboarding.config.ts` – Conversation config (turn limits, etc.)
- `onboarding-throttler.guard.ts` – IP-based throttling
- `dto/` – OnboardingChatDto, OnboardingCompleteDto

**Public Routes (IP Rate-Limited 30 req/hour):**
- `POST /onboarding/chat` – Start or continue onboarding chat
  - Body: `{ nativeLanguage?, targetLanguage?, message?, conversationId? }`
  - Response: `{ conversationId, reply, messageId, turnNumber, isLastTurn }`

- `POST /onboarding/complete` – Extract structured profile from conversation
  - Cached after first success (idempotent)
  - Response: Extracted user profile (name, native lang, target lang, level, etc.)

- `GET /onboarding/conversations/:conversationId/messages` – Fetch transcript (resume UX)

**Entities Used:**
- `AiConversation`, `AiConversationMessage`, `Language`

**Dependencies:**
- `AiModule` – Gemini LLM for chat

**Key Pattern:** Stateless; profile extraction via structured output; IP-based throttling.

---

### 10. **Admin Content Module** (`/admin/content`)
**Purpose:** Generate, publish, and manage lesson/scenario drafts (admin-only)

**Files:**
- `admin-content.controller.ts`
- `admin-content.service.ts` – Content generation, publication
- `dto/` – GenerateContentDto, ListContentQueryDto, UpdateContentDto
- `prompts/` – Prompt templates for AI generation

**Protected Routes (Admin-Only):**
- `POST /admin/content/generate` – AI-generated content drafts
  - Rate: 5 req/min
  - Body: `{ contentType (lesson|scenario), language, topic, level }`
  - Response: Draft content with metadata

- `GET /admin/content` – List content (filters: type, status, language)

- `PATCH /admin/content/:id/publish` – Publish draft to production
  - Query: `type` (lesson|scenario)

- `PATCH /admin/content/:id` – Update draft
  - Query: `type`

- `DELETE /admin/content/:id` – Archive content
  - Query: `type`

**Guard:** `AdminGuard` (verifies admin role)

**Entities Used:** Content-related entities (likely Lesson, Scenario via dynamic tables)

**Key Pattern:** Draft → Published lifecycle; admin-gated generation; type-agnostic CRUD via query param.

---

### 11. **Email Module** (`/email`)
**Purpose:** SMTP service wrapper (Nodemailer)

**Files:**
- `email.service.ts` – Email sending abstraction

**Responsibilities:**
- OTP sending (for password reset, disabled)
- Graceful fallback if SMTP unconfigured

**External Service:**
- **SMTP Provider** – User-configured (via env: SMTP_HOST, SMTP_USER, SMTP_PASS)

**Key Pattern:** Optional initialization; logs warning if unconfigured.

---

### 12. **Progress Module** (`/progress`)
**Purpose:** User progress tracking (read-only export)

**Files:**
- `progress.service.ts` – Progress queries
- `progress.module.ts` – TypeORM feature module

**Entities Used:**
- `UserProgress`, `UserExerciseAttempt`

**Key Pattern:** Exported service (imported by other modules); no controller (internal use only).

---

## New Modules Since Last Changelog Entry (2026-03 Commits)

**Identified New Modules:**
1. **Scenario Chat Module** – `feat(scenario): add scenario chat API with access control` (250096a)
2. **Vocabulary Module** – `feat(vocabulary): add Leitner SRS vocabulary module` (512404)
3. **Onboarding Module Enhancement** – `feat(onboarding): add resume support with cached profile extraction` (ed6508a)

**Recent Changes:**
- Firebase Auth migration (unified endpoint replacing Google/Apple separate flows)
- Email/password auth soft-disabled (410 Gone responses)
- Sentry HTTP tracing integration
- Langfuse observability for all LLM calls

---

## External Services & Dependencies

| Service | Module | Purpose | Auth Method |
|---------|--------|---------|------------|
| **Firebase Auth** | auth | User sign-in (Google, Apple) | ID token |
| **RevenueCat** | subscription | IAP subscriptions | Webhook signature |
| **Langfuse** | ai | LLM observability | SDK (in-process) |
| **OpenAI** | ai | LLM + STT | API key |
| **Anthropic** | ai | LLM | API key |
| **Google Gemini** | ai | LLM + STT | API key |
| **Supabase Storage** | ai | Audio file storage | Row-level security |
| **SMTP** | email | Email delivery | User credentials |
| **Sentry** | (global) | Error tracking & tracing | DSN |

---

## Cross-Module Guards & Decorators

| Guard/Decorator | Location | Purpose |
|-----------------|----------|---------|
| `@Public()` | common | Skip JWT auth |
| `@CurrentUser()` | auth | Inject authenticated user |
| `@ActiveLanguage()` | common | Inject user's active language |
| `@AutoEnrollLanguage()` | common | Auto-enroll user if missing language |
| `@OptionalAuth()` | common | Allow anonymous requests |
| `@RequirePremium()` | common | Subscription check |
| `PremiumGuard` | common | Enforce premium subscription |
| `AdminGuard` | common | Enforce admin role |
| `JwtAuthGuard` | auth | JWT validation (global) |
| `ThrottlerGuard` | nestjs | Rate limiting |

---

## Key Architectural Patterns

1. **Language Context Propagation** – X-Learning-Language header; auto-enrollment via decorator
2. **Premium Gating** – `PremiumGuard` + `@RequirePremium()` decorator (Scenario, some AI endpoints)
3. **SSE Streaming** – Real-time chat responses via `/ai/chat/stream`
4. **Rate Limiting** – Multi-tier (ai-short: 20/min, ai-medium: 100/hour; onboarding: 30/hour/IP)
5. **Observability** – Langfuse spans per conversation; Sentry tracing
6. **Webhook Idempotency** – DB constraint on RevenueCat event ID
7. **Leitner SRS** – In-memory session store for vocabulary review
8. **Cached Profile Extraction** – Onboarding completion results cached to prevent re-computation

---

## Unresolved Questions

- Are there API routes for Lesson CRUD beyond GET /lessons (i.e., admin lesson creation)?
- Does Progress module expose any public endpoints or only internal service exports?
- Are there scheduled jobs (cron) for vocabulary due-date recalculation or subscription renewal checks?

