# Project Changelog

**Last Updated:** 2026-03-08
**Project:** AI Language Learning Backend

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Planned
- Redis caching layer for frequently accessed data
- Per-user rate limiting middleware
- Background job processing with Bull/BullMQ
- Email notification service (SendGrid/Mailgun)
- Admin dashboard for user management
- Health check endpoints

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
| 1.1.0 | 2026-03-08 | Current | HTTP logging, Sentry, language flags, documentation |
| 1.0.0 | 2026-02-04 | Stable | MVP foundation - 8 modules, 30+ endpoints |
| 2.0.0 | 2026-02-24 | Stable | OAuth improvements, auto-linking, composite tokens |

---

## Migration Guide: v1.0.0 to v1.1.0

**No Breaking Changes**
- All existing endpoints compatible
- Documentation updates only
- Infrastructure improvements (logging, monitoring)

---

## Migration Guide: v1.0.0 to v2.0.0

**Breaking Changes:**

1. Google OAuth endpoint changed
   - Old: OAuth redirect flow (GET /auth/google → callback)
   - New: Direct ID token (POST /auth/google with idToken)
   - Action: Update frontend to use Google SDK for ID token generation

2. All refresh tokens revoked
   - Reason: Changed to composite format
   - Action: Users must re-login after migration
   - System generates new tokens automatically

3. Deprecated dependencies removed
   - Remove: passport-google-oauth20
   - Update: Frontend OAuth integration

**Database Schema:**
- Migration auto-applies provider ID columns
- Columns nullable (backward compatible)
- No manual intervention required

**Testing:**
- Unit tests updated for new token format
- E2E tests updated for Google ID token endpoint
- Comprehensive coverage maintained

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
