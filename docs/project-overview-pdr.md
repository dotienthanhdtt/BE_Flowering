# Project Overview & PDR

**Last Updated:** 2026-03-11
**Version:** 1.2
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
- Profile extraction via AI
- Scenario generation
- Max 10 turns per session

### 4. Subscription Management
- RevenueCat integration for cross-platform subscriptions
- Webhook-based lifecycle management
- Multiple plan types (free, monthly, yearly, lifetime)

### 5. Push Notifications
- Firebase Cloud Messaging (FCM)
- Multi-device support per user
- Cross-platform tokens (iOS, Android, Web)

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
- **Firebase Admin SDK** - Push notifications
- **OpenAI/Anthropic/Google AI** - LLM providers
- **Langfuse** - AI observability
- **Sentry** - Error tracking (5xx exceptions)

## API Modules

| Module | Endpoints | Key Features |
|--------|-----------|--------------|
| **auth/** (24 files) | POST /auth/register, /login, /google, /apple, /refresh, /logout, /forgot-password, /verify-otp, /reset-password | JWT, OAuth auto-linking, password reset |
| **ai/** (~32 files) | POST /ai/chat, /grammar/check, /exercises/generate, /pronunciation/assess, /chat/correct, /translate, /conversations | LangChain, multi-provider, translation, correction, rate limiting (100/hr free, 1000/hr premium) |
| **onboarding/** (11 files) | POST /onboarding/start, /chat, /complete | Anonymous chat, session-based (10-turn max, 7d TTL) |
| **language/** (10 files) | GET /languages, POST/PATCH/DELETE /languages/user | Language CRUD, native/learning flags |
| **user/** (5 files) | GET /users/me, PATCH /users/me | Profile management |
| **subscription/** (6 files) | GET /subscriptions/me, POST /webhooks/revenuecat | RevenueCat webhook, status checks |
| **notification/** (6 files) | POST /notifications/devices, DELETE /notifications/devices/:token | FCM token management |
| **email/** (2 files) | Internal service | Nodemailer SMTP for OTP delivery |

## Database Schema (14 Entities)

**Core:** User, Language, UserLanguage
**Content:** Lesson, Exercise
**Progress:** UserProgress, UserExerciseAttempt
**AI:** AiConversation (anonymous/authenticated), AiConversationMessage, Vocabulary
**Infrastructure:** Subscription, DeviceToken, RefreshToken, PasswordReset

**Recent Updates:**
- Language: `isNativeAvailable`, `isLearningAvailable`, `flagUrl`
- AiConversation: `type` (ANONYMOUS/AUTHENTICATED), `sessionToken`, `expiresAt`, `messageCount`
- AiConversationMessage: `translatedContent`, `translatedLang` (sentence translation caching)
- User: `googleProviderId`, `appleProviderId`
- PasswordReset: OTP flow support
- Vocabulary: NEW entity for user's translated words with definition & examples

## Product Development Requirements (PDR)

### Functional Requirements

**FR-1: User Authentication** (Critical)
- Register with email/password
- Login via email/password, Google, Apple
- JWT tokens with 7-day expiry
- Password reset via OTP (10min) + reset token (15min)

**FR-2: AI Learning Features** (Critical)
- Chat practice, vocabulary, grammar, translation
- Multi-provider support with fallback
- Rate limiting: 20 req/min, 100 req/hr per user
- Request tracking via Langfuse

**FR-3: Subscription Management** (High)
- RevenueCat integration
- Status tracking (active, expired, cancelled, trial)
- Webhook processing <60s

**FR-4: Push Notifications** (Medium)
- Firebase FCM registration
- Multi-device support per user
- Automatic token cleanup

**FR-5: Onboarding** (High)
- Anonymous session-based chat
- No authentication required
- Max 10 turns, 7-day TTL

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

- 34 API endpoints operational
- 8 modules implemented (138 TS files, ~8,330 LOC)
- 14 database entities with RLS
- 12 AI models supported
- Zero critical security vulnerabilities

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
