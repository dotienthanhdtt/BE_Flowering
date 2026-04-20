# Project Overview & PDR

**Last Updated:** 2026-04-20
**Version:** 1.8.0
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
- **PostgreSQL 14+** (Supabase)
- **TypeORM** - ORM with migrations
- **Row-Level Security** - Data isolation

### Authentication
- **JWT** - Token-based auth
- **bcrypt** - Password hashing
- **Google Auth Library** - ID token verification
- **Apple Sign-In** - OAuth verification

### External Integrations
- **RevenueCat** - Subscriptions
- **OpenAI/Anthropic/Google AI** - LLM providers
- **Langfuse** - AI observability
- **Sentry** - Error tracking (5xx exceptions)

## API Modules (12 Total)

| Module | Endpoints | Key Features |
|--------|-----------|--------------|
| **auth/** (27 files) | POST /auth/firebase, /refresh, /logout, /forgot-password, /verify-otp, /reset-password | Firebase unified OAuth, JWT, password reset; email/password endpoints disabled (410 Gone) |
| **ai/** (~30 files) | POST /ai/chat, /chat/correct, /translate, /transcribe; SSE /ai/chat/stream | LangChain multi-provider, STT with signed URLs, vocabulary storage, rate limiting |
| **onboarding/** (11 files) | POST /onboarding/chat (create+continue), /complete (idempotent), GET /conversations/:id/messages | Anonymous chat, first-turn via message count, resume support with caching |
| **language/** (9 files) | GET /languages, POST/PATCH/DELETE /languages/user | Language CRUD, native/learning flags, language context guard |
| **user/** (5 files) | GET /users/me, PATCH /users/me | Profile management |
| **subscription/** (6 files) | GET /subscriptions/me, POST /webhooks/revenuecat | RevenueCat webhook, DB idempotency |
| **email/** (2 files) | Internal service | Nodemailer SMTP with graceful init |
| **lesson/** (6 files) | GET /lessons (paginated, language-partitioned) | Scenario grouping, status computation, premium gating |
| **scenario/** (7 files) | POST /scenario/chat (turn-based roleplay) | Roleplay conversations, premium access control |
| **vocabulary/** (16 files) | CRUD + Leitner SRS review endpoints | Spaced repetition with 5-box system, review sessions |
| **admin-content/** (8 files) | POST /admin/content/generate, GET /admin/content, PATCH/DELETE | LLM content generation, lifecycle (draft→published→archived) |
| **progress/** (3 files) | Internal service | Lesson/exercise progress tracking |

## Database Schema (20 Entities: 18 + 2 Enums)

**Core:** User, Language, UserLanguage
**Content:** Lesson, Exercise, Scenario, ScenarioCategory, UserScenarioAccess
**Progress:** UserProgress, UserExerciseAttempt
**AI:** AiConversation, AiConversationMessage, Vocabulary
**Infrastructure:** Subscription, RefreshToken, PasswordReset, WebhookEvent, DeviceToken
**Enums:** AccessTier (free|premium), ContentStatus (draft|published|archived)

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
- Sentry error tracking for 5xx
- Langfuse AI request tracing
- HTTP logger middleware
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
