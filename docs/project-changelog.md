# Project Changelog

**Last Updated:** 2026-03-28
**Project:** AI Language Learning Backend

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### In Progress
- Unit test coverage expansion
- E2E test suite development

---

## [1.3.0] - 2026-03-28 (Codebase Cleanup & API Standardization)

### Removed
- **POST /ai/exercises/generate Endpoint:** Exercise generation (not called by mobile app)
- **POST /ai/pronunciation/assess Endpoint:** Pronunciation assessment from audio (not called by mobile app)
- **POST /ai/conversations + GET /ai/conversations/:id/messages Endpoints:** Conversation CRUD operations (superseded by chat endpoint)
- **POST /subscriptions/sync Endpoint:** Subscription sync (redundant with RevenueCat webhooks)
- **Entire Notification Module:** FCM device token management (not used by mobile app)
  - POST /notifications/devices (register FCM token)
  - DELETE /notifications/devices/:token (unregister device)
  - DeviceToken entity and related services

### Changed
- **API JSON Key Naming Convention:** All HTTP request/response JSON keys now use `snake_case`
  - Example: `idToken` → `id_token`, `displayName` → `display_name`, `sessionToken` → `session_token`
  - Exception: Wrapper keys `code`, `message`, `data` remain unchanged
  - Internal TypeScript code remains `camelCase` (only JSON serialization affected)
- **API Endpoint Count:** 35 → 31 active endpoints (4 removed)
- **Database Entities:** 14 → 13 (DeviceToken removed)

### Added
- **docs/mobile-api-reference.md:** New concise mobile-focused API reference guide

### Documentation Updates
- api-documentation.md: Converted all field names to snake_case, removed unused endpoints, updated version to 1.3.0
- codebase-summary.md: Updated endpoint count and entity count
- project-overview-pdr.md: Removed notification module, updated counts
- system-architecture.md: Removed notification module diagrams
- project-roadmap.md: Updated Phase 2 completion status

---

## [1.2.2] - 2026-03-24 (Grammar Consolidation & Langfuse Stability)

### Removed
- **POST /ai/grammar/check Endpoint:** Consolidated grammar checking into /ai/chat/correct
  - grammar-check.dto.ts (deleted, -54 LOC)
  - grammar-check-prompt.md (deleted, -26 LOC)
  - checkGrammar() method from learning-agent.service.ts (removed, -26 LOC)
  - Grammar check route from ai.controller.ts
- **Grammar Check DTO Exports:** Removed from dto/index.ts

### Changed
- **Correction Check Prompt:** Simplified correction-check-prompt.md
  - Now ignores punctuation and capitalization differences
  - Bolds only grammar fixes and language replacements (e.g., **went** for **go**)
  - Handles gibberish/emoji-only input (returns null)
- **Endpoint Access:** POST /ai/chat/correct and POST /ai/translate now use `@RequirePremium(false)` decorator
  - Fully public endpoints (work for anonymous users and free accounts)
  - Support optional premium features
- **AI Require-Premium Decorator:** Changed from manual @OptionalAuth() to declarative `@RequirePremium(false)`

### Fixed
- **Langfuse Output Tracing:** Fixed missing traces in all 3 LLM providers
  - OpenAI provider: Fresh CallbackHandler per invocation with await handler.flushAsync()
  - Anthropic provider: Same pattern, explicit flush in finally block
  - Gemini provider: Same pattern, ensures handler lifecycle management
  - Root cause: Shared handler instances not flushed before response returned

### Updated Documentation
- API docs: Removed grammar check section, updated auth for correction and translate endpoints
- Codebase summary: Updated endpoint list, changed prompt count (10→9), updated Langfuse description
- System architecture: Removed grammar check from AI module flow, updated Langfuse section with handler lifecycle
- Code standards: Updated prompt management example, replaced OptionalAuth pattern with RequirePremium(false), added Langfuse tracing pattern

---

## [1.2.1] - 2026-03-14 (Subscription Payment Features)

### Added
- **WebhookEvent Entity:** Database-based webhook idempotency for RevenueCat
  - Stores processed webhook event IDs to prevent duplicates across server restarts
  - Fields: eventId (primary key), eventType, processedAt (timestamptz)
  - Replaces previous in-memory Set implementation
- **POST /subscriptions/sync Endpoint:** Mobile-initiated subscription sync with RevenueCat
  - Called by mobile app after purchase and on app open
  - Queries RevenueCat API for current entitlements
  - Updates local Subscription record with latest status
  - Returns: SubscriptionDto with isActive field
- **PremiumGuard & @RequirePremium() Decorator:** Feature-level subscription checking
  - Guards all AI endpoints (chat, grammar, exercises, pronunciation, translate, correct, conversations)
  - Returns 403 Forbidden if user lacks active premium subscription
  - Used alongside global JwtAuthGuard for two-tier protection
- **Subscription.isActive Field:** Boolean flag indicating active status (replaces manual status checking)

### Changed
- **AI Module Auth Requirements:** All endpoints now require premium subscription
  - Changed from `@OptionalAuth()` to `@RequirePremium()` for /ai/translate and /ai/chat/correct
  - Grammar check, exercises, pronunciation, chat all now premium-only
  - Free users can only access onboarding and language catalog
- **Webhook Processing:** Now idempotent via WebhookEvent table
  - Insert eventId first (acts as unique constraint lock)
  - Skip processing if duplicate detected (catches already processed)
  - Returns success (200) regardless to meet RevenueCat 60s requirement

### Updated Documentation
- API docs: Added POST /subscriptions/sync, marked all AI endpoints as (Premium)
- Codebase summary: Updated entity count (15 now), documented WebhookEvent and PremiumGuard
- System architecture: Added sync flow diagram, premium feature access section, updated Subscription module flow
- Roadmap & changelog aligned with new features

### Database Migrations
- New migration: 1740500000000-create-webhook-events-table.ts
  - Creates webhook_events table with eventId as primary key
  - Indexes: processedAt for cleanup queries

---

## [Unreleased] (Future)

### Planned
- Redis caching layer for frequently accessed data
- Per-user rate limiting middleware
- Background job processing with Bull/BullMQ
- Email notification service (SendGrid/Mailgun)
- Admin dashboard for user management
- Health check endpoints

---

## [1.2.0] - 2026-03-09 (Current)

### Added
- **Translation Service:** POST /ai/translate endpoint supporting WORD and SENTENCE types
  - Word translation with vocabulary persistence (saves to Vocabulary entity)
  - Sentence translation with message-based caching (fetches AiConversationMessage by ID)
  - Optional authentication (JWT or sessionToken)
  - Pronunciation extraction for word translations
- **Vocabulary Entity:** Database entity for storing user's translated words
  - Fields: word, translation, sourceLang, targetLang, partOfSpeech, pronunciation, definition, examples (JSONB)
  - Unique constraint: (userId, word, sourceLang, targetLang)
- **Correction Check Endpoint:** POST /ai/chat/correct with context-aware grammar checking
  - Validates previousAiMessage, userMessage, targetLanguage (max 10 chars)
  - Returns correctedText or null if no errors
  - Optional auth (JWT or anonymous)
- **Comprehensive Documentation:** All docs updated to reflect actual codebase state
  - API endpoints: 34 total (verified)
  - Database entities: 14 total (registered in database.module.ts)
  - AI models: 12 supported (OpenAI 3, Anthropic 2, Google 5)
  - TypeScript files: 138 in src/, ~8,330 LOC

### Changed
- AI module: 28 files, ~2,234 LOC with translation and correction services
- System architecture updated with Translation service flow, 14 entities mapped
- Code standards clarified entity registration pattern (database.module.ts + feature module)
- Roadmap Phase 2 progress: 50% → 65% complete (documentation completed)
- Project changelog updated with accurate entity count (14, not 15)

### Fixed
- Entity count corrected: 14 entities (Language, User, UserLanguage, Lesson, Exercise, UserProgress, UserExerciseAttempt, AiConversation, AiConversationMessage, Vocabulary, Subscription, DeviceToken, RefreshToken, PasswordReset)
- API endpoint count: 34 (9 auth, 9 AI, 6 language, 2 user, 1 subscription, 1 webhook, 2 notification, 3 onboarding, 1 health)
- All documentation files aligned with actual codebase state

---

## [1.1.0] - 2026-03-08

### Added
- **HTTP Logger Middleware:** Logs all incoming requests and outgoing responses with method, URL, status code, response time
- **Language Native/Learning Flags:** New database columns `isNativeAvailable`, `isLearningAvailable`, `flagUrl` for language filtering
- **Prompt Asset Copying:** Markdown prompt files now copied to dist/ via nest-cli assets configuration
- **Documentation Updates:** Comprehensive updates to all docs (api-docs, codebase-summary, system-architecture, project-overview, roadmap, changelog)

### Changed
- Onboarding config optimized (maxTurns=10, sessionTtlDays=7, model=GPT-4o-mini)
- Documentation reflects all 8 modules (including onboarding and email)
- API documentation corrected with actual response format: `{code: 1|0, message, data}`
- Roadmap updated with Phase 2 progress (35% complete)

### Fixed
- API documentation response format corrected (was showing wrong format)
- Module count in codebase-summary updated to 8 (from 6)
- Missing endpoints documented (password reset, logout, onboarding, language)

---

## [1.0.0] - 2026-02-04

### Added (Phase 1 - MVP Foundation)

**Core Infrastructure:**
- NestJS 11 modular architecture with 8 feature modules
- TypeScript 5.7 with strict mode enabled
- PostgreSQL 14+ via Supabase with TypeORM
- Global response wrapper: `{code: 1, message, data}`
- Global exception filter with BaseResponseDto
- Global JWT auth guard (bypass via @Public())
- CORS configuration via environment variables
- Input validation via class-validator and Joi

**Authentication Module (24 files):**
- Email/password registration and login
- Google OAuth via ID token (google-auth-library@^10.5.0)
- Apple Sign-In via identity token
- JWT token generation with 7-day expiry
- Composite refresh tokens (uuid:hex format) for O(1) validation
- OAuth auto-linking to existing email addresses
- Provider-specific ID columns (`googleProviderId`, `appleProviderId`)
- Password reset flow (OTP 10min + reset token 15min)
- Logout endpoint with refresh token invalidation

**AI Module (~30 files):**
- LangChain integration with multi-provider support
- OpenAI support (GPT-4, GPT-4 Turbo, GPT-3.5)
- Anthropic support (Claude Sonnet, Opus, Haiku)
- Google AI support (Gemini 2.0 Flash, 1.5 Pro/Flash, 1.0 Pro)
- Chat endpoint with conversation management
- Stream endpoint (Server-Sent Events)
- Grammar checking service
- Exercise generation
- Pronunciation assessment via Whisper audio transcription
- Langfuse integration for all AI request tracing
- Rate limiting: 20 req/min, 100 req/hr per user
- Prompt management via markdown files

**Onboarding Module (11 files):**
- Anonymous session-based chat (no authentication required)
- Max 10 turns per session
- 7-day session TTL
- Profile extraction via AI
- Scenario generation

**Language Module (10 files):**
- Language catalog with 50+ languages
- User language preferences with proficiency levels
- Native language selection
- Language filtering (public endpoint)

**User Module (5 files):**
- Profile management (name, profile picture)
- User data retrieval

**Subscription Module (6 files):**
- RevenueCat webhook integration
- Subscription status tracking (active, expired, cancelled, trial)
- Plan types: free, monthly, yearly, lifetime
- Webhook event handling: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, PRODUCT_CHANGE
- Timing-safe Bearer token validation
- Async webhook processing (<60s response requirement)

**Notification Module (6 files):**
- Firebase Cloud Messaging (FCM) integration
- Device token registration and management
- Multi-device support per user
- Cross-platform support (iOS, Android, Web)
- Automatic token deduplication

**Email Module (2 files):**
- Nodemailer SMTP integration
- OTP delivery for password reset

**Database Schema (14 Entities):**
- User (with OAuth provider IDs)
- RefreshToken (composite format)
- PasswordReset (for password reset flow)
- Language
- UserLanguage
- Lesson (future content)
- Exercise (future content)
- UserProgress (future tracking)
- UserExerciseAttempt (future tracking)
- AiConversation (with anonymous/authenticated type support)
- AiConversationMessage
- Subscription
- DeviceToken
- Row-Level Security (RLS) policies on all tables

**Monitoring & Observability:**
- Langfuse integration for AI request tracing
- Sentry error tracking (with 20% sampling in prod, 100% in dev)
- NestJS contextual logging
- Swagger API documentation at `/api/docs`

**Configuration:**
- Environment validation via Joi schema
- Support for multiple AI providers via strategy pattern
- Configurable JWT expiration (default: 7 days)
- CORS origins configuration
- Supabase RLS policies for data isolation

**Documentation:**
- API documentation with all endpoints
- Codebase summary with architecture overview
- System architecture with diagrams
- Code standards and patterns
- Project overview with PDR
- Project roadmap with phases
- This changelog

**Testing:**
- Jest unit test framework configured
- Auth module comprehensive test coverage
- E2E test setup

---

## [2.0.0] - 2026-02-24

### Added
- **Google ID Token Endpoint:** POST /auth/google with direct ID token verification (replaces OAuth redirect flow)
- **OAuth Auto-linking:** OAuth accounts auto-link to existing users by email match
- **Provider-specific ID Columns:** `googleProviderId` and `appleProviderId` for duplicate prevention
- **Composite Refresh Tokens:** uuid:hex format for O(1) validation performance
- **Google ID Token Validator Strategy:** New service for secure token verification

### Changed
- **Database Migration:** Added provider ID columns, revoked existing refresh tokens
- **Google Auth Endpoint:** Accepts `idToken` instead of OAuth flow
- **Auth Service:** Token generation now uses composite format

### Removed
- Deprecated Passport Google OAuth strategy
- OAuth redirect endpoints (GET /auth/google, /auth/google/callback)
- passport-google-oauth20 dependency

### Fixed
- OAuth duplicate account issue via auto-linking
- Refresh token validation performance (O(n) → O(1))

### Security
- Google token validation via official google-auth-library
- Provider IDs prevent OAuth account hijacking
- Composite refresh token maintains constant length

---

## Version History

| Version | Release Date | Status | Focus |
|---------|-------------|--------|-------|
| 1.2.0 | 2026-03-09 | Current | Translation, correction, vocabulary, docs alignment |
| 1.1.0 | 2026-03-08 | Stable | HTTP logging, Sentry, language flags |
| 1.0.0 | 2026-02-04 | Stable | MVP foundation - 8 modules, 34 endpoints |

---

## Migration Guide: v1.1.0 to v1.2.0

**No Breaking Changes**
- All existing endpoints compatible
- New endpoints: POST /ai/translate, POST /ai/chat/correct
- Vocabulary entity added (non-breaking)
- Documentation updates with accurate counts

**New Features to Test:**
- Translation endpoint (WORD and SENTENCE types)
- Correction check with context
- Vocabulary persistence

---

## Migration Guide: v1.0.0 to v1.1.0

**No Breaking Changes**
- All existing endpoints compatible
- HTTP logger added (transparent)
- Language flags added (non-breaking schema)

---

## Migration Guide: v1.0.0 (Early Version to Current)

**Complete rewrite** of OAuth system (see v2.0.0 notes in archived releases)

---

## Known Issues

None currently tracked. All issues resolved or in progress.

---

## Deprecation Notices

### Google OAuth 2.0 Strategy (Removed in v2.0.0)
- **Reason:** Google deprecated OAuth redirect flow for mobile; ID token pattern more secure
- **Alternative:** Use official Google SDK to obtain ID token, send to POST /auth/google
- **Impact:** More secure implementation without server-side OAuth flow complexity

---

## Future Release Notes

### v1.2.0 (Planned: 2026-03-20)
- Unit test coverage >80%
- E2E test suite
- Redis caching layer
- Per-user rate limiting
- Health check endpoints

### v2.0.0 (Planned: 2026-05-15)
- Content management system
- Analytics tracking
- Email notifications
- Admin dashboard
- User progress tracking

### v3.0.0 (Planned: 2026-07-25)
- Background job processing
- Real-time features (WebSocket)
- Social features
- Advanced AI capabilities
- Multi-region deployment
