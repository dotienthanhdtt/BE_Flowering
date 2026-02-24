# Project Changelog

**Last Updated:** 2026-02-24
**Project:** AI Language Learning Backend

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Planned
- Redis caching layer for frequently accessed data
- Rate limiting middleware (per-user limits)
- Background job processing with Bull/BullMQ
- Email notification service (SendGrid/Mailgun)
- Admin dashboard for user management

---

## [2.0.0] - 2026-02-24

### Added
- **Google ID Token Endpoint:** Replaced OAuth redirect flow with direct ID token authentication (`POST /auth/google`)
  - Clients obtain ID token via Google SDK, send to backend for verification
  - Uses `google-auth-library@^10.5.0` for secure token validation
  - Eliminates deprecated Passport OAuth strategies
- **OAuth Auto-linking:** OAuth accounts now auto-link to existing users matching email address
  - Prevents duplicate accounts when user signs up via different OAuth provider
  - Replaces previous ConflictException behavior
- **Provider-specific ID Columns:** `googleProviderId` and `appleProviderId` added to users table
  - Tracks OAuth account links to prevent duplicate provider associations
  - Enables efficient provider-based account lookup
- **Composite Refresh Tokens:** Refresh token format changed to `{uuid}:{hex}`
  - Improves validation performance: O(1) PK lookup vs O(n) bcrypt scan
  - Maintains security while optimizing database queries
- **Google ID Token Validator Strategy:** New `google-id-token-validator.strategy.ts` service
  - Handles token verification using google-auth-library
  - Extracts and validates user profile claims from token payload

### Changed
- **Database Migration:** `1740100000000-auth-improvements-provider-columns.ts`
  - Added `google_provider_id` VARCHAR column (nullable)
  - Added `apple_provider_id` VARCHAR column (nullable)
  - Revoked all existing refresh tokens (forced re-authentication on next use)
- **User Entity:** `user.entity.ts` updated with new provider ID fields
- **Auth Service:** `generateTokens()` and `refreshTokens()` now use composite token format
- **Google Auth Endpoint:** `POST /auth/google` now accepts `idToken` (not `token`)
  - New optional parameters: `displayName`, `sessionToken`
  - Direct token verification eliminates server-side OAuth flow

### Removed
- **Deprecated Files:**
  - `src/modules/auth/strategies/google.strategy.ts` (Passport OAuth strategy)
  - `src/modules/auth/guards/google-auth.guard.ts` (OAuth flow guard)
  - `GET /auth/google` endpoint (OAuth initiation)
  - `GET /auth/google/callback` endpoint (OAuth callback)
  - `passport-google-oauth20` dependency (replaced with google-auth-library)

### Fixed
- OAuth duplicate account issue now resolved via auto-linking on email match
- Refresh token validation performance improved from O(n) to O(1)

### Security
- Google token validation via official google-auth-library (not deprecated strategy)
- Provider IDs prevent OAuth account hijacking via email update
- Composite refresh token format maintains constant 72-char length

---

## [1.0.0] - 2026-02-04

### Added (Phase 1 - MVP Foundation)
- **Project Structure:** NestJS modular architecture with 6 feature modules
- **Authentication:** Email/password signup, login, refresh token mechanism
- **Google OAuth:** OAuth 2.0 flow with Passport strategy (deprecated in v2.0)
- **Apple Sign-In:** Apple identity token verification
- **User Management:** Profile CRUD endpoints
- **Language Module:** Language catalog and proficiency tracking
- **AI Features:** LangChain integration with multi-provider support
  - OpenAI (GPT-4, GPT-4 Turbo, GPT-3.5)
  - Anthropic (Claude Sonnet, Opus, Haiku)
  - Google AI (Gemini models)
- **Chat System:** Conversation management with streaming responses (SSE)
- **Grammar Checking:** AI-powered grammar correction and feedback
- **Exercise Generation:** Dynamic language learning exercise creation
- **Pronunciation Assessment:** Whisper audio transcription for assessment
- **Subscription Management:** RevenueCat webhook integration
- **Push Notifications:** Firebase FCM device token management
- **Database:** PostgreSQL (Supabase) with TypeORM and migrations
- **API Documentation:** Swagger/OpenAPI setup
- **Error Handling:** Global exception filter with BaseResponseDto wrapper
- **Validation:** class-validator and Joi schemas
- **Observability:** Langfuse tracing for AI requests

### Database Schema
- 13 entities: User, Language, UserLanguage, Lesson, Exercise, UserProgress, UserExerciseAttempt, Subscription, RefreshToken, DeviceToken, AiConversation, AiConversationMessage

### Configuration
- Environment validation via Joi schema
- Support for multiple LLM providers via strategy pattern
- Configurable JWT expiration and CORS origins
- Supabase RLS policies for data isolation

### Documentation
- API documentation at `/api/docs`
- Codebase summary with architecture overview
- System architecture diagrams
- Code standards and patterns

---

## Version History

| Version | Release Date | Status | Key Features |
|---------|-------------|--------|--------------|
| 2.0.0   | 2026-02-24  | Current | OAuth improvements, auto-linking, composite tokens |
| 1.0.0   | 2026-02-04  | Stable | MVP foundation, all core features |

---

## Migration Guide

### From v1.0.0 to v2.0.0

**Breaking Changes:**
1. Google OAuth endpoint changed
   - Old: `GET /auth/google` → `GET /auth/google/callback`
   - New: `POST /auth/google { idToken, displayName?, sessionToken? }`
   - Clients must update to use Google SDK for ID token generation

2. All refresh tokens revoked
   - Users must re-login after migration
   - System generates new composite format tokens

3. Deprecated dependencies removed
   - Remove `passport-google-oauth20` if not used elsewhere
   - Update frontend OAuth integration to use `@react-oauth/google` or similar

**No Database Schema Updates Required:**
- Migration auto-applies `google_provider_id` and `apple_provider_id` columns
- Existing user data compatible (columns nullable)

**Testing:**
- Unit tests updated for new token format
- E2E tests updated for Google ID token endpoint
- Coverage remains comprehensive

---

## Deprecation Notice

**Google OAuth 2.0 Strategy (removed in v2.0.0)**
- Reason: Google deprecated OAuth 2.0 redirect flow for mobile; moving to ID token pattern
- Migration: Clients should use official Google SDK to obtain ID token, send to `POST /auth/google`
- Impact: More secure and simpler implementation without server-side OAuth flow

