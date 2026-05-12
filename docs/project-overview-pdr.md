# Project Overview & PDR

**Last Updated:** 2026-05-11
**Version:** 1.10.0
**Status:** Active Development

## Executive Summary

AI-powered language learning backend built with NestJS 11 and TypeScript. Provides authentication (email, Google, Apple with auto-linking), AI-driven learning features via LangChain, subscription management via RevenueCat, and push notifications via Firebase. Designed for mobile-first language learning applications.

## Product Vision

Create a scalable, secure backend infrastructure that powers personalized AI-driven language learning experiences. Enable seamless subscription management, real-time notifications, and multi-provider AI tutoring.

## Core Features

### 1. Authentication & User Management
- Email/password authentication with JWT
- Google OAuth (ID token) with auto-linking
- Apple Sign-In with auto-linking
- Password reset (OTP + reset token flow)
- User profile management

### 2. AI-Powered Learning
- Conversation practice with AI tutors
- Vocabulary explanations & translations (word/sentence)
- Grammar correction with context awareness
- Translation services with vocabulary persistence
- Multi-provider AI (OpenAI, Anthropic, Google AI) with Langfuse tracing

### 3. Onboarding (Anonymous)
- Session-based chat for new users (no auth needed)
- Profile extraction via AI with idempotent caching
- Scenario generation with stable UUIDs for resume support
- Max 10 turns per session
- Resume UX: fetch conversation transcript via GET /messages endpoint

### 4. Subscription Management
- RevenueCat integration for cross-platform subscriptions
- Webhook-based lifecycle management
- Multiple plan types (free, monthly, yearly, lifetime)

## Technical Stack

### Backend Framework
- **NestJS 11.x** - Enterprise TypeScript framework
- **TypeScript 5.x** - Type-safe development
- **Node.js 20+** - Runtime environment

### Database
- **PostgreSQL 18** (Railway)
- **TypeORM** - ORM with migrations
- **S3-compatible Object Storage** (Railway) for audio & static assets

### Authentication
- **JWT** - Token-based auth
- **bcrypt** - Password hashing
- **Google Auth Library** - ID token verification
- **Apple Sign-In** - OAuth verification

### External Integrations
- **Railway** - PostgreSQL database + S3-compatible object storage
- **RevenueCat** - Subscriptions
- **OpenAI/Anthropic/Google AI** - LLM providers
- **Langfuse** - AI observability
- **Firebase Admin** - Push notifications (FCM)

## API Modules (14 Total)

| Module | Endpoints | Key Features |
|--------|-----------|--------------|
| **admin-content/** (7 files) | POST /admin/content/generate, GET /admin/content, PATCH/DELETE | LLM content generation, lifecycle (draft→published→archived), throttled 5/min |
| **ai/** (31 files) | POST /ai/chat, /chat/correct, /translate, /transcribe; SSE /ai/chat/stream | LangChain multi-provider, STT with signed URLs, 20 req/min + 100 req/hr rate limit |
| **auth/** (23 files) | POST /auth/firebase, /refresh, /logout | Firebase unified OAuth, JWT, composite refresh tokens (90d); email/password disabled (410 Gone) |
| **email/** (2 files) | Internal service | Nodemailer SMTP with graceful init |
| **kol-bundle/** (7 files) | POST /admin/bundles/create, GET /bundles, POST /redeem | Admin KOL bundle creation, gift codes, scenario attachment |
| **language/** (10 files) | GET /languages, POST/PATCH/DELETE /languages/user | Language CRUD, native/learning flags, per-language proficiency (CEFR/JLPT/HSK/TOPIK), auto-enroll |
| **lesson/** (6 files) | GET /lessons (paginated, language-partitioned) | Scenario grouping, status computation, premium gating, auto-enroll support |
| **onboarding/** (13 files) | POST /onboarding/chat (create+continue), /complete (idempotent), GET /conversations/:id/messages | Anonymous chat, first-turn via message count, resume support, rate-limited (5 create/hr, 30 chat/hr) |
| **personalization/** (8 files) | POST /personalization/generate | Tier-gated intake → scenario generation, quota (Free blocked, Premium 1/mo trial, Plus unlimited), de-dup (24h + snapshot diff), soft-cap prune (30/user), advisory lock race safety |
| **progress/** (2 files) | Internal service | Lesson/exercise progress tracking, upsertProgress, recordAttempt |
| **scenario/** (23 files) | GET /scenarios (listing), GET /scenarios/:id (detail), POST /scenario/chat, GET /scenario/conversations | Listing + chat (2 controllers), roleplay, 12-turn cap, signed access control, throttled redeem 5/min |
| **subscription/** (6 files) | GET /subscriptions/me, POST /webhook | RevenueCat webhook with signature verify, sandbox rejection in prod |
| **user/** (5 files) | GET /users/me, PATCH /users/me | Profile management |
| **vocabulary/** (16 files) | CRUD + Leitner SRS review endpoints | Spaced repetition (5-box), in-memory sessions, review rate tracking |

## Database Schema (21 Entities + 5 Enums)

**Core:** User, Language, UserLanguage
**Content:** Lesson, Exercise, Scenario, ScenarioCategory, UserScenarioAccess, UserAiScenario, KolBundle, KolBundleScenario
**Progress:** UserProgress, UserExerciseAttempt
**AI:** AiConversation, AiConversationMessage, Vocabulary
**Infrastructure:** Subscription, RefreshToken, PasswordReset, WebhookEvent, DeviceToken
**Enums:** AccessTier (free|premium|premium_plus), ContentStatus (draft|published|archived), ScenarioType, UserRole, AiConversationType (learn_chat|personalize_intake|onboard)

**Recent Updates (May 2026):**
- **Supabase → Railway Migration (2026-05-11):** Database (PostgreSQL 14→18), object storage (Supabase Storage→S3-compatible), RLS removed (auth via app layer)
  - New migrations: drop RLS, rewrite asset URLs to `/assets/*` endpoint
  - New ObjectStorageService (AWS SDK v3), AssetsController for bucket passthrough
  - New env vars: STORAGE_*, APP_PUBLIC_URL
  - Credentials exposed in chat — rotate after cutover
- **Personalization module (2026-05-04):** Tier-gated scenario generation with quota enforcement, de-dup gate, advisory lock, soft-cap pruning
- **User schema updates:** Added personalizedTrialUsedAt, lastPersonalizationAt, personalizationProfileSnapshot columns
- **Scenario schema:** Added triggersPersonalization flag for intake-triggered generation
- **AccessTier enum:** Added premium_plus value
- **AiConversationType enum:** Added personalize_intake value

**Recent Updates (Apr 2026):**
- **AccessTier refactor:** `access_tier` enum replaces `is_premium`; default: free
- **ContentStatus lifecycle:** `status` enum (draft|published|archived) replaces `is_active`; published = active
- **Admin flag:** User.isAdmin for admin-content endpoints
- **Onboarding caching:** AiConversation.extractedProfile + scenarios JSONB for idempotent resume
- **First-turn detection:** Via messageCount (not presence); supports restart resilience
- **Signed URLs:** Private audio bucket with presigned 1h-expiry URLs for STT outputs
- **Graceful init:** Firebase, Email services degrade gracefully on misconfiguration
- **Session expiry removed:** No TTL; onboarding sessions persist indefinitely

## Product Development Requirements (PDR)

### Functional Requirements

**FR-1: User Authentication** (Critical)
- Register with email/password
- Login via email/password, Google, Apple
- JWT tokens with 7-day expiry
- Password reset via OTP (10min) + reset token (15min)

**FR-2: AI Learning Features** (Critical)
- Chat practice, grammar correction, translation
- Multi-provider support with fallback
- Rate limiting: 20 req/min, 100 req/hr per user
- Request tracking via Langfuse

**FR-3: Subscription Management** (High)
- RevenueCat integration
- Status tracking (active, expired, cancelled, trial)
- Webhook processing <60s

**FR-4: Onboarding** (High)
- Anonymous session-based chat
- No authentication required
- Max 10 turns per session
- Idempotent profile extraction with caching
- Resume support via transcript fetch endpoint

### Non-Functional Requirements

**NFR-1: Security** (Critical)
- bcrypt hashing (10+ salt rounds)
- JWT HS256
- Timing-safe webhook validation
- Row-Level Security (RLS) on all tables
- No sensitive data in logs

**NFR-2: Performance** (High)
- API response <500ms (p95)
- Database queries optimized
- Webhook processing async
- Connection pooling

**NFR-3: Observability** (Medium)
- Langfuse AI request tracing
- HTTP logger middleware
- Console/stdout logging for errors and exceptions
- Health check endpoints (future)

## Success Metrics

- 45+ API endpoints operational
- 12 modules implemented (~175 TS files, ~10,500 LOC)
- 18 database entities + 2 enums with RLS
- 8 AI models supported (3 OpenAI, 2 Anthropic, 3 Google)
- 2 STT providers (OpenAI Whisper primary, Gemini fallback)
- Zero critical security vulnerabilities
- Email/password auth disabled (410 Gone); Firebase unified OAuth only

## Deployment

- **Environments:** Development, Staging, Production
- **Build:** TypeScript compiled to JavaScript
- **Migrations:** Automated via TypeORM CLI
- **CI/CD:** Run linting, tests, build, migrate, deploy

## Future Enhancements

**Short-term (1-3 months)**
- Rate limiting middleware
- Health check endpoints
- Comprehensive E2E tests

**Medium-term (3-6 months)**
- Background job processing (Bull)
- Email notification service
- Content recommendation engine

**Long-term (6-12 months)**
- Real-time features (WebSocket)
- Social features (friends, leaderboards)
- Microservices for AI module
- GraphQL API
