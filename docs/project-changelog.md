# Project Changelog

**Last Updated:** 2026-05-13
**Project:** AI Language Learning Backend

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## 2026-05-13 — Remove Sentry Error Tracking

### Removed

- **`@sentry/node` dependency** from package.json
- **Sentry initialization** from `src/instrument.ts` — now only sets up Langfuse OTel SpanProcessor
- **`Sentry.captureException()` call** in `src/common/filters/all-exceptions.filter.ts` — 5xx errors now logged to console.error() instead
- **`sentry: { dsn }` config block** from `src/config/app-configuration.ts`
- **`SENTRY_DSN` environment variable** from `src/config/environment-validation-schema.ts` and `.env.example`

### Changed

- **Error handling:** 5xx exceptions logged to stdout/console instead of Sentry; Railway captures these logs automatically via log streaming
- **Documentation:** Updated `codebase-summary.md`, `project-overview-pdr.md`, `system-architecture.md`, `deployment.md` to remove Sentry references; added notes to `project-roadmap.md`

### Notes

- **No impact to functionality.** Error logging continues via NestJS logger and console output (captured by Railway).
- **No breaking changes.** Migration simply removes external error tracking in favor of platform-native log aggregation.
- **Langfuse tracing** for AI requests remains unchanged and operational.

---

## 2026-05-13 — Route onboarding chat & sentence translation through 9router

### Changed

- **Anonymous onboarding chat turns** (`IntakeChatEngine.runTurn` via `onboardingEngineConfig`) now run through 9router's `flowering_chat` alias. On a `ServiceUnavailableException` the turn retries once against `gemini-3.1-flash-lite` (logged; Langfuse metadata tagged `fallback: flowering_chat->gemini-3.1-flash-lite`). Profile extraction / scenario generation and the personalization intake chat are unchanged (still Gemini).
- **Sentence translation** (`TranslationService.translateSentence`) now calls `flowering_chat` (via 9router) instead of Gemini, with the same Gemini fallback on 9router unavailability (`fallback: ninerouter->gemini`). Word and chunk translation are unchanged (still GPT-4.1-nano).

### Added

- `IntakeChatEngineConfig.chatModel` / `chatFallbackModel` — optional per-feature model overrides for the per-turn chat call; default to the engine's built-in Gemini model when unset.

### Notes

- No new env vars or model aliases — reuses the existing `flowering_chat` alias and `NINEROUTER_KEY`/`NINEROUTER_URL`. Without `NINEROUTER_KEY`, these features fall back to Gemini on every request.

## 2026-05-12 — 9router LLM Provider

### Added

- **`NineRouterLLMProvider`** (`src/modules/ai/providers/ninerouter-llm.provider.ts`) — OpenAI-compatible AI gateway provider. LangChain `ChatOpenAI` client pointed at `${NINEROUTER_URL}/v1` with `NINEROUTER_KEY` Bearer token; supports streaming; Langfuse-traced like the other LLM providers. Registered in `AiModule` and `UnifiedLLMService`.
- **`LLMModel.NINEROUTER_FLOWERING_CHAT = 'flowering_chat'`** — server-side model alias on 9router. `getProviderFromModel()` routes `flowering_chat` (and any future 9router aliases) to the `ninerouter` provider via an explicit allowlist.
- **Env vars** `NINEROUTER_URL` (default `https://9router-dev.up.railway.app`) and `NINEROUTER_KEY` (secret, no committed default) — added to Joi schema, `app-configuration.ts`, `.env.example`.

### Changed

- **Scenario roleplay chat** (`ScenarioChatService`) now uses `flowering_chat` (via 9router) instead of Gemini as its default model. On a 9router `ServiceUnavailableException`, it transparently retries once with `gemini-3.1-flash-lite-preview` so the turn still completes (logged; Langfuse metadata tagged `fallback: ninerouter->gemini`). `/ai/chat` tutor and onboarding intake chat are unchanged (still Gemini).

### Notes

- No existing provider was removed. 9router's STT/image/TTS/embeddings endpoints are out of scope.
- Deploy: set `NINEROUTER_KEY` (and optionally `NINEROUTER_URL`) in Railway env vars. Without the key, scenario chat falls back to Gemini on every request.

## 2026-05-11 — Supabase → Railway Migration (Database + Storage)

### Added

- **Migration `1781000000000-drop-supabase-rls.ts`** — Drops RLS policies (inert on app layer; auth enforced via global JWT guard)
- **Migration `1781100000000-rewrite-asset-urls-to-railway.ts`** — Rewrites flag_url (×8) and image_url (×25) from Supabase Storage public URLs to `${APP_PUBLIC_URL}/assets/...`
- **ObjectStorageService** (`src/database/object-storage.service.ts`) — Replaces SupabaseStorageService
  - Public API: `uploadAudio()`, `getSignedUrl()`, `deleteFile()`, `listUserFiles()`, plus new `getObject()`
  - AWS SDK v3 client for S3-compatible Railway bucket
  - Presigned URL generation (1h expiry, SigV4)
  - Boot-tolerant: logs warning if bucket not configured, doesn't crash app
- **AssetsController** (`src/assets.controller.ts`) — New `@Public() GET /assets/*path` endpoint
  - Streams objects from private bucket
  - Cache headers (immutable, 1-year max-age, strong ETag)
  - Path traversal protection (rejects `..`, empty paths)
  - Registered in AppModule

### Changed

- **Database Provider:** Supabase PostgreSQL → Railway PostgreSQL 18
  - Schema migrated via `pg_dump` (schema-only) + data copy via Supabase MCP execute_sql
  - All sequences fixed, RLS disabled (now inert)
  - Row counts verified: 1,840 rows across 23 tables
- **Object Storage Provider:** Supabase Storage → Railway S3-compatible bucket
  - Audio transcriptions uploaded to private bucket
  - Presigned URLs (1h expiry) returned to mobile clients
  - Static images (flags, scenario art) rehosted and served via `/assets/*` passthrough endpoint
- **Dependencies Removed:** `@supabase/supabase-js`
- **Dependencies Added:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- **Environment Variables (New):**
  - `STORAGE_ENDPOINT` — Railway S3 endpoint (e.g., `https://t3.storageapi.dev`)
  - `STORAGE_BUCKET` — Bucket name
  - `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` — AWS-compatible credentials
  - `STORAGE_REGION` — e.g., `auto`
  - `APP_PUBLIC_URL` — Base URL for `/assets/*` links (default: `http://localhost:3000`)
- **Environment Variables (Deprecated but Kept for Transition):**
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — Now optional, unused

### Database

- 2 new migrations (drop RLS, rewrite asset URLs)
- Supabase-specific `extensions.uuid_generate_v4()` calls now use PostgreSQL 18 built-in `gen_random_uuid()`
- Zero data loss; all existing data migrated to Railway

### Testing

- All existing tests pass (no changes to API contracts)
- Smoke test: `/assets/language_flag/de.png` → 200 with PNG content-type

### Documentation Impact

- `system-architecture.md` — External integrations: Railway PostgreSQL + S3, removed Supabase
- `codebase-summary.md` — Database/storage tech stack, new env vars, dependency list updated
- `project-overview-pdr.md` — Updated DB provider line (if present)
- `project-changelog.md` — This entry

### Known Debt

- Credentials exposed in chat (Railway DB password, bucket keys) — **rotate after cutover**
- Supabase project can be paused once parity confirmed

### Scope

- **Completed:** Dev environment cutover (schema, data, RLS removal, asset migration)
- **Deferred:** Prod migration (scheduled separately)

---

## 2026-05-04 — Auto-Generate Personalized Scenarios (Tier-Gated)

### Added

- **Personalization Module** (`src/modules/personalization/`) — Tier-gated AI intake chat → scenario generation
  - **PersonalizationController** — `POST /personalization/generate` accepts chat turn, manages paywall mid-flow
  - **PersonalizationService** — Orchestrates quota check, de-dup gate, LLM generation, pruning
  - **PersonalizationQuotaService** — Tier enforcement: Free blocked, Premium 1/month free trial (then paywall), Premium Plus unlimited, 3/day hard ceiling
  - **PersonalizationDedupService** — 24h rolling window + profile snapshot JSON diff prevents duplicate intakes & LLM cost
  - **PersonalizationTriggerService** — Detects scenario-chat completion via `triggersPersonalization` flag, uses Postgres advisory lock for race safety
  - **PersonalizationPruneService** — Lazy soft-cap enforcement: auto-deletes oldest unused PERSONAL scenarios over 30 per user on insert
  - **LangfuseService.recordEvent()** — Exports observability for outcome telemetry (`personalization.generated`, `personalization.dedup_skip`, `personalization.paywall`, `personalization.daily_ceiling`)

- **Schema Migrations** (`src/database/migrations/1780100000000-add-personalization-fields.ts`)
  - `premium_plus` added to `AccessTier` enum
  - `personalize_intake` added to `AiConversationType` enum
  - Three new nullable User columns: `personalizedTrialUsedAt`, `lastPersonalizationAt`, `personalizationProfileSnapshot`
  - Scenario entity: `triggersPersonalization` boolean flag

- **IntakeChatEngine Refactor** (`src/modules/ai/services/intake-chat-engine.service.ts`)
  - Extracted reusable intake chat engine from OnboardingService (~160 lines)
  - Shared by onboarding + personalization, reduces duplication
  - Type-safe request/response contract via `IntakeChatEngineTypes`

- **Personalization DTOs** — Request/response shapes for chat turn and scenario generation result
  - `CompleteResult` discriminated union: `{status: "completed", scenarios}` | `{status: "paywall", message}` | `{status: "dedup_skip", message}`
  - Persistent conversation resume: paywall mid-flow stores state, user can resume from same turn

- **Prompts** (4 new files)
  - `personalize-chat-prompt.json` — AI intake instruction (language, goals, context)
  - `personalize-extraction-prompt.md` — Profile extraction from user responses
  - `personalize-scenarios-prompt.json` — LLM generation of 5 scenarios from profile
  - Both extraction + generation integrated into PersonalizationService workflow

- **Test Infrastructure** — Fixed all 526 pre-existing tests broken by centralize-scenarios refactor
  - ScenarioType.SYSTEM → ScenarioType.SYSTEM enum rename
  - UserAiScenario removal (replaced by Scenario.ownerUserId)
  - findOne() OR-array queries → findOne() with explicit OR conditions
  - All test suites re-verified passing

### Changed

- **scenario-chat.service.ts** — Integrated personalization trigger gate
  - After chat completion: checks `scenario.triggersPersonalization`, calls PersonalizationTriggerService if applicable
  - No breaking changes; personalization is opt-in per scenario

- **onboarding.service.ts** — Simplified via IntakeChatEngine extraction (~360 LOC → ~200 LOC)

- **LangfuseService** — Now exports recordEvent() for custom outcome tracking (beyond LLM traces)

### Database

- Migration adds 4 new columns + 2 enum values
- Zero data loss; existing scenarios unaffected (triggersPersonalization defaults false, personalization columns NULL for existing users)

### Testing

- All 526 unit/integration tests passing (includes Phase 9 test coverage)
- E2E tests passing with mocked LLM calls

### Documentation Impact

- System architecture: personalization module diagram + trigger flow
- API documentation: new POST /personalization/generate endpoint
- Codebase summary: module count 12 → 13, service count updated
- Code standards: tier-gated feature pattern, advisory lock usage, discriminated union response patterns

### Scope Exclusions (v1)

- Mobile UX wiring (separate `app_flowering` plan)
- TZ-aware quota windows (UTC calendar months in v1)
- Cron-based pruning (lazy on-insert in v1)
- Profile history (snapshot only, latest retained)
- Admin UI for triggersPersonalization flag

### Next Steps

- Mobile implementation plan for personalization UX (app_flowering)
- Langfuse telemetry monitoring (quota/paywall conversion rates)
- Premium Plus tier rollout coordination

---

## 2026-04-21 — Language-Specific Proficiency Levels

### Added

- **Per-Language Proficiency Frameworks:** CEFR (European), JLPT (Japanese), HSK (Chinese), TOPIK (Korean) replacing shared 5-tier enum
  - Framework registry in `src/modules/language/constants/proficiency-frameworks.ts`
  - Native-only languages (vi, th) remain frameworkless
  - Custom validator `IsValidProficiencyLevelForFramework` validates level belongs to selected framework
  - All 6 backend phases completed with 403 unit tests passing

- **Swagger Decorator Updates:** 3 DTOs updated with multi-framework examples
  - `UpdateUserLanguageDto.proficiencyLevel` — examples: ['A1','B1','N3','HSK3','TOPIK2','beginner']
  - `UserLanguageDto.proficiencyLevel` — same examples
  - `ChatDto.proficiencyLevel` — replaced enum constraint with framework-aware examples
  - `UserLanguageDto.levelFramework` — new @ApiProperty with enum hints

- **E2E Test Infrastructure:** 4 integration tests covering language-specific levels
  - Japanese onboarding (JLPT levels)
  - Update with valid level (N3)
  - Rejection of invalid level (X9)
  - Cross-language validation (N3 on English → 400)
  - AI chat integration with stored framework level
  - Test file: `test/language-specific-levels.e2e-spec.ts`
  - All 4 tests passing

- **Build & Compilation:** ESLint config updated to ignore test/ directory

### Changed

- **Onboarding auto-mapping:** Generic `'beginner'` level transparently mapped to language-specific framework default via `mapGenericToFramework()` helper

### Database

- Migration `1776500000000-add-level-framework-to-user-languages` adds framework tracking
- Auto-backfill existing users preserving level semantics (e.g., 'intermediate' → 'B1' for CEFR)
- Zero data loss migration

### Testing

- 403 unit tests passing (all phases)
- 4 E2E tests passing (Phase 7)
- Build clean: `npm run build`, `npm run lint` green

### Documentation Updates

- `codebase-summary.md` — Framework registry, custom validator, per-language levels explained
- `code-standards.md` — Proficiency framework validation pattern
- `system-architecture.md` — Data model updated with levelFramework field
- `api-documentation.md` — Swagger examples showing CEFR/JLPT/HSK/TOPIK levels
- Updated project-roadmap.md Phase 2 progress (99% → adding language-specific levels completion)

### Scope Exclusions (by design)

- `scenario-chat-prompt.json` — UNTOUCHED (user directive). Behavioral consequence: literal `'beginner'` check on line 21 no longer matches migrated users (they have framework-specific levels). Accepted per user requirement.
- No grace shim for stale Flutter clients (400 rejection recommended; reassess after staging telemetry)

### Next Steps

- Flutter phase: mobile model + LanguageLevelPicker widget (Phase 6, pending)
- Staging deployment (operational): confirm `/api/docs` rendering, 48h monitoring
- Production rollout: after staging green

---

## 2026-04-21

### Added

- **GET /scenarios/:id — Scenario Detail Endpoint:** Returns full scenario detail with soft-lock access state
  - `isLocked=true, lockReason="premium_required"` for premium scenarios without subscription (no 403)
  - `ScenarioAccessService.checkAccess()` non-throwing method; existing `findAccessibleScenario` (chat flow) unchanged
  - `ScenariosDetailService`, `ScenarioDetailDto`, `ScenariosModule` wired with `SubscriptionModule`

---

## 2026-04-20 — Security Hardening Sprint (Final)

### Added

- **Graceful Service Initialization:** Firebase Admin SDK and Nodemailer SMTP now initialize with try-catch
  - `initialized` flag on services; endpoints return proper errors if unavailable
  - App boot never crashes due to misconfigured external services

- **Signed URLs for Private Audio Bucket:** STT output audio files now use presigned URLs (1h expiry)
  - Supabase private bucket for `audio-files` (requires RLS deny public reads in console)
  - Response includes presigned URL for secure mobile download

- **First-Turn Detection Refactor:** Onboarding first-turn now via authoritative `messageCount` 
  - Supports resume across server restarts and connection interruptions
  - Fixes retry edge case from previous message-presence logic

### Changed

- **Conversationid Requirement:** Learning agent chat methods now require `conversationId` (previously optional)
  - Enforces conversation context for all AI interactions
  - Removes ambiguous state

### Database

- No new migrations (signed URLs, graceful init, first-turn detection are logical changes)

### Documentation

- `codebase-summary.md` — Module count (12), entity count (18+2), STT signed URLs, onboarding first-turn detection
- `code-standards.md` — New section: "External Service Integration Patterns" (graceful init, signed URLs, rate limiting tiers)
- `system-architecture.md` — Updated AI flow diagram, Firebase graceful init, signed URL details, onboarding first-turn
- `mobile-api-reference.md` — Email/password endpoints marked 410 Gone; added Lessons, Scenarios, Vocabulary endpoints
- `project-overview-pdr.md` — 12 modules, 20 entities (18+2 enums), updated success metrics, recent updates summary
- `project-changelog.md` — This entry

### Breaking Changes

**None.** All changes are backward compatible or non-breaking.

---

## 2026-04-20 — Auto-Enroll Language on GET /lessons

### Added

- **@AutoEnrollLanguage() Decorator:** Opt-in per-route decorator to enable auto-enrollment of unenrolled languages
  - Stored as metadata in `src/common/decorators/active-language.decorator.ts`
  - Applied to `LessonController` class to auto-enroll users in languages when calling `GET /lessons` with `X-Learning-Language: <new-code>`

- **Auto-Enroll Guard Logic:** Extended `LanguageContextGuard` to auto-create `user_languages` rows on demand
  - Checks route/class for `@AutoEnrollLanguage()` metadata
  - If present and user not enrolled: auto-creates inactive `user_languages` row (`isActive: false`, `proficiencyLevel: BEGINNER`)
  - Validates `Language.isLearningAvailable=true` before insert
  - Idempotent: race-safe via post-error existence check
  - Failure-tolerant: logs warning if insert fails but allows request to proceed

- **Test Coverage:** New `language-context.guard.spec.ts` with 12 tests covering:
  - Existing behavior: enrolled users, unknown codes, anonymous/public routes
  - Auto-enroll: creates inactive row, validates isLearningAvailable, handles races, prevents deactivation of existing active language
  - Regression: non-auto-enroll routes still throw 403 for unenrolled languages

### Changed

- **GET /lessons Behavior:** Now allows users to request lessons in any language they haven't enrolled in yet
  - Transparent auto-enrollment creates temporary (inactive) enrollment
  - Lessons filtered by requested language code
  - User's previously-active language remains `isActive: true` (no side effects)

### Documentation

- `codebase-summary.md` — Updated Language Context Module description with auto-enroll pattern
- `api-documentation.md` — New "Auto-Enroll Behavior" section under Language Context Header with route list
- Plan `plan.md` — Marked as `completed` with all todo items and success criteria checked

### No Breaking Changes
- Auto-enroll is opt-in per route via decorator
- Existing endpoints (AI chat, exercises) unaffected — still throw 403 for unenrolled languages
- No DTO or mobile contract changes
- No schema migrations needed

---

## 2026-04-20 — BREAKING: Content Access Tier Refactor

### Breaking Changes

**Scenario & Lesson Entity Refactor:**
- **Removed fields:**
  - `is_premium` (boolean) — replaced by `access_tier` enum
  - `is_trial` (boolean) — trial status removed; content lifecycle now handled by `status` field
  - `is_active` (boolean) — removed; use `status = 'published'` to indicate active content
- **Added fields:**
  - `access_tier` (enum: `free | premium`) — determines subscription requirement; default `free`
  - `status` (ContentStatus enum: `draft | published | archived`) — now owns lifecycle (published = active, archived = inactive)
- **ScenarioStatus DTO enum:** `TRIAL` value removed from mobile-facing response; remaining: `available | locked | learned`

### Status Computation Changes

Old logic:
```
status = 'trial' (free users only) | 'locked' (is_premium && free users) | 'available' (others)
```

New logic:
```
status = 'locked' (access_tier == 'premium' && free users) | 'available' (otherwise)
```

### Database Migration

- Migration `src/database/migrations/1777001000000-refactor-content-access-tier.ts`
  - Backfills `access_tier = 'free'` for all scenarios/lessons
  - Drops `is_premium`, `is_trial`, `is_active` columns
  - Adds `access_tier` and `status` columns

### API Changes

**GET /lessons response:**
- Scenario status values now: `available | locked | learned` (no `trial`)
- Visibility rules: only `status = 'published'` scenarios returned
- Free users blocked from `access_tier = 'premium'` scenarios

**PATCH /admin/content/:id:**
- Now accepts optional `access_tier` field in request body
- Example: `{ "title": "Updated", "access_tier": "premium" }`

### Service Updates

- `scenario-access.service.ts` — renamed `checkPremiumAccess()` → `checkAccessTierAccess()`
- `lesson.service.ts` — updated visibility filter to use `status = 'published'`
- `admin-content.service.ts` — now accepts and saves `accessTier` field
- Seed data — updated to emit `accessTier` instead of `isPremium/isTrial`
- LLM prompts — updated to generate `accessTier` field instead of legacy boolean flags

### Documentation Updates

- `codebase-summary.md` — Entity field lists updated
- `system-architecture.md` — Data model & status computation logic updated
- `api-documentation.md` — Scenario status values and visibility rules updated
- `project-changelog.md` (this file) — New entry added

### Migration Path

**No backward compatibility (pre-release):**
- App not yet released; no mobile client migration needed
- Old boolean flags completely removed from schema
- Services refactored to use new enum-based model

---

## 2026-04-15 — Session Expiry Removal

### Changed
- **Session Expiration Removed:** 7-day TTL on anonymous onboarding sessions removed. Sessions now persist indefinitely.
- `expiresAt` column on `ai_conversations` table is now deprecated (kept for backward compatibility, never populated).

### Documentation Updates
- All docs (`codebase-summary.md`, `system-architecture.md`, `project-overview-pdr.md`, `api/onboarding-api.md`, `api-documentation.md`) updated to remove session expiry references.
- Clarified that sessions persist indefinitely (no TTL).

---

## 2026-04-14 — Onboarding Resume Support

### Added

- `GET /onboarding/conversations/:conversationId/messages` — fetch anonymous onboarding transcript for mobile resume UX.

### Changed

- `POST /onboarding/complete` is now idempotent. Cached `extracted_profile` + `scenarios` columns added to `ai_conversations`. Second call returns same data with stable scenario UUIDs; no extra LLM tokens.

### Database

- Migration `1776100000000-add-onboarding-cache-to-ai-conversations` adds `extracted_profile JSONB NULL` + `scenarios JSONB NULL` to `ai_conversations`. No backfill required.

---

## 2026-04-14 — BREAKING: Onboarding Endpoint Consolidation

### Breaking Changes
- **Endpoint Removal:** `POST /onboarding/start` removed entirely
- **Endpoint Consolidation:** `POST /onboarding/chat` now handles both session creation and chat turns
  - New session: omit `conversation_id`, include `native_language` + `target_language` → AI greeting response on turn 1
  - Chat continuation: include `conversation_id` + `message` → AI responds to user
- **Response Shape Change:** 
  - Old `/start` response: `{conversation_id, expires_at}`
  - Old `/chat` response: `{response, turn_count, max_turns}`
  - New unified response: `{conversation_id, reply, message_id, turn_number, is_last_turn}`
- **Rate Limiting:** Differentiated by operation
  - New session creation: 5 req/hr per IP
  - Chat continuation: 30 req/hr per IP
  - Previously: blanket 30 req/hr

### Migration Required
- **Mobile clients:** Remove all calls to `POST /onboarding/start`; migrate to single `POST /onboarding/chat` endpoint with dual request body shapes
- **Backend consumers:** If any internal services call old `/start` endpoint, update to consolidated flow
- **Tests:** Old `/start` tests no longer valid; rewrite with consolidated pattern

### Technical Details
- Implementation: `src/modules/onboarding/onboarding.controller.ts`, `onboarding.service.ts`
- Rate limiting: Custom `OnboardingThrottlerGuard` with branching rules
- Database: No schema changes; conversation session storage unchanged

---

## 2026-04-13 — Security & Hardening Sprint

### Critical Security Fixes
- **RevenueCat webhook**: now requires `REVENUECAT_WEBHOOK_SECRET` env at boot; always verifies signature (no silent bypass)
- **Sandbox isolation**: production env now rejects sandbox webhook events
- **Premium gate**: lesson access now checks subscription expiration (`currentPeriodEnd > now`) — fixes drift from missed EXPIRATION webhooks
- **JWT secret**: removed fallback literal; missing `JWT_SECRET` now fails boot

### AI Cost Protection
- `/ai/translate` and `/ai/chat/correct`: switched from `@Public()` to `@OptionalAuth()` with stricter per-IP throttle (5/min)
- `/onboarding/*`: per-IP rate limits added (30 req/hr controller-wide, 5/hr on `/start`)
- Prompt loader: now eager-loads all `.md` and `.json` prompts at module init (catches Docker packaging issues at boot)

### Reliability & Auth
- RevenueCat webhook: now processes synchronously — RC retries on failure instead of fire-and-forget
- Email/password authentication endpoints (`/auth/register`, `/login`, `/forgot-password`, `/verify-otp`, `/reset-password`): soft-disabled (HTTP 410 Gone). Google/Apple OAuth (`/auth/firebase`) is now the only auth method. Existing accounts kept; service code preserved.
- Email service: graceful `onModuleInit` — bad SMTP config no longer crashes app boot

### Data Correctness
- Supabase audio bucket: now uses signed URLs (1h expiry). **Manual step required**: set `audio-files` bucket to private + RLS deny public reads in Supabase dashboard.
- Onboarding chat: first-turn detection now uses authoritative message count, not message presence — fixes retry edge case
- Learning agent: `conversationId` now required in chat methods (was conditionally validated)

---

## Older Releases (Archived)

Pre-2026-04-13 release notes (v1.0.0 – v2.0.0, plus the 2026-02/03 sprint logs) moved to [`changelog-archive.md`](./changelog-archive.md) to keep this file focused on recent changes.

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
