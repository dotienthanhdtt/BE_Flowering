# API Documentation

**Last Updated:** 2026-04-18
**Base URL:** `http://localhost:3000` (development)
**API Version:** 2.0.0

## Overview

RESTful API for AI-powered language learning application. All endpoints except webhooks and public auth require JWT authentication via Bearer token. All responses wrapped in standard format: `{code: 1, message, data}` (code 1 = success, 0 = error).

## Response Format

### Success Response (code: 1)
```json
{
  "code": 1,
  "message": "Success message",
  "data": {...}
}
```

### Error Response (code: 0)
```json
{
  "code": 0,
  "message": "Error description",
  "data": null
}
```

### JSON Key Naming

**All JSON keys (request body params and response data fields) use `snake_case`.** Internally DTOs use camelCase; a request middleware (`SnakeToCamelCaseMiddleware`) and response interceptor (`ResponseTransformInterceptor`) convert between the two transparently.

```json
// Request
{ "target_language": "vi", "proficiency_level": "beginner" }

// Response data
{ "user_id": "abc", "access_token": "...", "created_at": "2026-03-28T..." }
```

The wrapper keys `code`, `message`, `data` are single-word and unchanged.

URL path params use camelCase (e.g., `:scenarioId`, `:languageId`, `:sessionId`) — those bypass the body middleware. Query-string keys use snake_case (e.g., `?language_code=en`).

## Authentication

### Bearer Token Format
```
Authorization: Bearer <jwt_token>
```

### Token Details
- Default expiry: 7 days
- Algorithm: HS256
- Public routes: Use @Public() decorator

### Language Context Header

**Required for:** All content endpoints (lessons, scenarios, exercises, AI chat)

```
X-Learning-Language: <language_code>
```

**Purpose:** Specifies user's active learning language for request-scoped content partitioning.

**Valid values:** ISO 639-1 language codes (e.g., `en`, `es`, `fr`, `ja`, `vi`). Must match a language code in the Language catalog.

**Behavior:**
- Header is validated and resolved to Language.id on every request
- Resolved language context is cached (LRU, 60s TTL)
- User must be enrolled in the language (have a `user_languages` row)
- Returns 400 if header missing or language code invalid
- Returns 403 (Forbidden) if user not enrolled in the language — **unless the route supports auto-enroll** (see below)
- Cached per language code for performance

**Auto-Enroll Behavior (Opt-in per route):**
Some routes (e.g., `GET /lessons`) support automatic enrollment when accessing a language the user is not yet enrolled in:
- If user sends `X-Learning-Language: <new-code>` but has no `user_languages` row for that language:
  - Guard auto-creates an inactive `user_languages` row (does not affect user's active language)
  - Content is filtered by the new language
  - User can later explicitly activate the language via `PATCH /languages/user/:id`
- Auto-enroll only succeeds if Language is active and `isLearningAvailable=true`
- Idempotent: multiple concurrent requests auto-enrolling the same language are race-safe
- If auto-enroll fails (DB error), request logs a warning but still proceeds (failure-tolerant)

**Routes with Auto-Enroll:**
- `GET /lessons` — auto-enroll on header language (opt-in via `@AutoEnrollLanguage()` decorator)

**Routes without Auto-Enroll:**
- `POST /scenario/chat`, `POST /ai/chat`, POST `/ai/chat/stream` — strict 403 if not enrolled

**cURL Example:**
```bash
curl http://localhost:3000/lessons \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-Learning-Language: es"
```

**Note:** Onboarding endpoints, user profile, subscriptions, and admin endpoints do NOT require this header.

## Endpoints

### Health Check

#### GET /
Liveness/health probe. Used by load balancers and Railway deploy checks.

**Auth:** Not required | **Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "status": "ok",
    "timestamp": "2026-04-14T09:00:00.000Z"
  }
}
```

---

### Authentication (POST /auth/*)

#### POST /auth/register | POST /auth/login
> **DISABLED — returns 410 Gone.** Email/password auth is no longer supported. Use `POST /auth/firebase`.

**Auth:** Not required | **Response (410):** `{code: 0, message: "Email/password authentication is no longer supported", data: null}`

---

#### POST /auth/firebase
Firebase sign-in (Google or Apple).

**Auth:** Not required | **Request:**
```json
{
  "id_token": "firebase_id_token",
  "display_name": "John Doe",
  "conversation_id": "optional_conversation_id"
}
```

**Response (200):** `{code: 1, message: "Authenticated", data: {access_token, refresh_token, user: {...}}}`

**Behavior:**
- Accepts Firebase ID token from either Google or Apple sign-in
- Auto-detects provider based on token claims
- Auto-links to existing email or creates new account
- Stores provider-specific ID (google_provider_id or apple_provider_id)
- Optionally links existing onboarding conversation

**Errors:** 401 (invalid token), 400 (missing id_token)

---

#### POST /auth/refresh
Refresh access token.

**Auth:** Not required | **Request:**
```json
{
  "refresh_token": "uuid:hex"
}
```

**Response (200):** `{code: 1, message: "Token refreshed", data: {access_token, refresh_token}}`

**Errors:** 401 (invalid/expired token)

---

#### POST /auth/logout
Invalidate refresh token.

**Auth:** Required | **Response (204):** No content

---

#### POST /auth/forgot-password | /verify-otp | /reset-password
> **DISABLED — returns 410 Gone.** Use `POST /auth/firebase`.

**Auth:** Not required | **Response (410):** `{code: 0, message: "Email/password authentication is no longer supported", data: null}`

---

### User Management (GET/PATCH /users/me)

#### GET /users/me
Get current user profile.

**Auth:** Required | **Response (200):**
```json
{
  "code": 1,
  "message": "User found",
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "John Doe",
    "avatar_url": "https://example.com/avatar.jpg",
    "email_verified": true,
    "native_language_id": "uuid",
    "native_language_code": "en",
    "native_language_name": "English",
    "created_at": "2026-03-01T10:00:00.000Z"
  }
}
```

---

#### PATCH /users/me
Update user profile.

**Auth:** Required | **Request:**
```json
{
  "display_name": "Jane Doe",
  "avatar_url": "https://example.com/avatar.jpg",
  "native_language_id": "uuid"
}
```

All fields optional. Response mirrors `GET /users/me`.

---

### Subscriptions

#### GET /subscriptions/me
Get subscription status.

**Auth:** Required | **Response (200):**
```json
{
  "code": 1,
  "message": "Subscription found",
  "data": {
    "id": "uuid",
    "plan": "monthly",
    "status": "active",
    "is_active": true,
    "expires_at": "2026-05-14T00:00:00.000Z",
    "cancel_at_period_end": false
  }
}
```

**Plan types:** free, monthly, yearly, lifetime
**Status types:** active, trial, expired, cancelled

---

#### POST /webhooks/revenuecat
RevenueCat webhook endpoint (idempotency via WebhookEvent table).

**Auth:** Bearer token (REVENUECAT_WEBHOOK_SECRET; not a JWT) | **Request:**
```json
{
  "event": {
    "id": "event_uuid",
    "type": "INITIAL_PURCHASE|RENEWAL|CANCELLATION|EXPIRATION|PRODUCT_CHANGE",
    "app_user_id": "user_uuid",
    "original_app_user_id": "user_uuid",
    "environment": "PRODUCTION",
    "product_id": "monthly_subscription",
    "purchased_at_ms": 1706976000000,
    "expiration_at_ms": 1709654400000
  }
}
```

> **Note:** RevenueCat delivers webhook payloads with `snake_case` event fields — vendor contract, consistent with our API's snake_case wire format.

**Response (200):** `{code: 1, message: "Webhook received", data: {status: "received"}}`

**Processing:** Async (responds <60s)

---

### Languages

#### GET /languages
List available languages (public).

**Auth:** Not required | **Query params:** `type=native|learning`

**Response (200):** `{code: 1, message: "Languages found", data: [{id, code, name, native_name, flag_url, is_active}]}`

---

#### GET /languages/user
Get the caller's learning languages.

**Auth:** Required | **Response (200):** `{code: 1, message: "User languages found", data: [{id, language: {...}, proficiency_level, level_framework, is_active}]}`

**Note:** `proficiency_level` is now language-specific (e.g., CEFR: A1–C2, JLPT: N5–N1, HSK: HSK1–HSK6, TOPIK: TOPIK1–TOPIK6). `level_framework` indicates the framework (CEFR/JLPT/HSK/TOPIK) or null for native-only languages.

---

#### POST /languages/user
Add language to the caller's learning list.

**Auth:** Required | **Request:**
```json
{
  "language_id": "uuid",
  "proficiency_level": "A1"
}
```

**Note:** `proficiency_level` must be valid for the language's framework. Framework-specific examples: CEFR (A1–C2), JLPT (N5–N1), HSK (HSK1–HSK6), TOPIK (TOPIK1–TOPIK6). Omit field to auto-default to lowest level.

**Response (201):** `{code: 1, message: "Language added", data: {...}}`

---

#### PATCH /languages/user/:languageId
Update language proficiency.

**Auth:** Required | **Request:**
```json
{
  "proficiency_level": "B1"
}
```

**Note:** `proficiency_level` must be valid for the language's framework.

**Response (200):** `{code: 1, message: "Language updated", data: {...}}`

---

#### PATCH /languages/user/native
Set native language.

**Auth:** Required | **Request:**
```json
{
  "language_id": "uuid"
}
```

**Response (200):** `{code: 1, message: "Native language set", data: {...}}`

---

#### DELETE /languages/user/:languageId
Remove language.

**Auth:** Required | **Response (200):** `{code: 1, message: "Language removed", data: null}`

---

### Lessons

#### GET /lessons
Get lessons grouped by category. **Auth:** Required | **Query:** language (uuid), level (beginner|intermediate|advanced), search (string), page (1+), limit (1-50, default 20).

**Response:** `{data: {categories: [{id, name, scenarios: [{id, title, image_url, difficulty, status}]}], pagination}}`

**Status:** available | locked (premium, free user) | learned. **Visibility:** published + (global OR matching language OR user_scenario_access). **Errors:** 400, 401

---

### Scenarios

#### GET /scenarios/default
List default scenarios for active language (paginated). **Auth:** Required | **Header:** `X-Learning-Language: <code>` (required) | **Query:** `page` (1+, default 1), `limit` (1-50, default 20) | **Response (200):** `{code: 1, message: "Scenarios found", data: {items: [{id, title, description, image_url, difficulty, type: "default", status}], total, page, limit}}`

**Type:** Only returns scenarios with `type='default'`. Automatically enrolls user in language if not yet enrolled. **Errors:** 400 (missing header), 401 (unauthorized), 403 (inactive language)

---

#### GET /scenarios/personal
List user's AI-generated + KOL-granted scenarios (merged). **Auth:** Required | **Header:** `X-Learning-Language: <code>` (required) | **Query:** `page`, `limit` | **Response (200):** `{code: 1, message: "Personal scenarios found", data: {items: [{id, title, source: "ai_generated"|"kol_granted", granted_at?, status}], total, page, limit}}`

**Merges:** UserAiScenario rows (AI-generated) + KolBundleScenario grant rows (KOL-granted). Sorted by granted_at descending. **Errors:** 400, 401, 403

---

#### POST /scenarios/redeem
Redeem a KOL gift code to grant access to scenarios. **Auth:** Required | **Rate Limit:** 5 req/min | **Request:** `{gift_code: "string"}` | **Response (200):** `{code: 1, message: "Scenarios redeemed", data: {redeemed_count: int, scenarios: [{id, title}]}}`

**Behavior:** Validates gift code exists + is active in KolBundle. For each bundle scenario, creates UserAiScenario row if user doesn't already have access. Idempotent (duplicate codes succeed without double-grants). **Errors:** 404 (code not found), 400 (invalid), 429 (throttled)

---

#### GET /scenarios/:id
Get full scenario detail including access state. **Auth:** Required | **Header:** `X-Learning-Language: <code>` (required) | **Path:** `id` (uuid)

**Response (200):** `{code: 1, message: "...", data: {id, title, description?, imageUrl?, difficulty, languageId, orderIndex, category: {id, name}, accessTier, isLocked, lockReason?}}`

**Soft-lock behavior:** Premium scenarios return `isLocked=true, lockReason="premium_required"` instead of 403, enabling mobile upgrade CTA in a single round-trip. **Errors:** 401, 404 (not found / wrong language / unpublished)

Sample responses:
```json
// FREE tier — 200
{"code":1,"data":{"id":"uuid","title":"Ordering Food","description":"Learn how to order at a restaurant","difficulty":"beginner","languageId":"uuid","orderIndex":1,"category":{"id":"uuid","name":"Restaurant"},"accessTier":"free","isLocked":false}}

// PREMIUM, no subscription — 200
{"code":1,"data":{"id":"uuid","title":"Luxury Hotel","description":"Practice checking into a 5-star hotel","difficulty":"intermediate","languageId":"uuid","orderIndex":5,"category":{"id":"uuid","name":"Hotel"},"accessTier":"premium","isLocked":true,"lockReason":"premium_required"}}

// PREMIUM, active subscription — 200
{"code":1,"data":{"id":"uuid","title":"Luxury Hotel","description":"Practice checking into a 5-star hotel","difficulty":"intermediate","languageId":"uuid","orderIndex":5,"category":{"id":"uuid","name":"Hotel"},"accessTier":"premium","isLocked":false}}

// Not found / language mismatch — 404
{"code":0,"message":"Scenario not found"}
```

---

### AI Features

Chat endpoint requires active premium subscription. Translation and correction endpoints are public but support optional premium. Use `@RequirePremium()` decorator with PremiumGuard for enforcement.

#### POST /ai/chat
Chat with AI tutor. **Auth:** Required (Premium) | **Request:** `{message, context: {conversation_id, target_language, native_language, proficiency_level, lesson_topic?, model?}}` | **Response:** `{data: {message, conversation_id}}`

#### SSE /ai/chat/stream
Stream chat (Server-Sent Events). **Auth:** Required (Premium) | **Response:** `text/event-stream` with chunks in `{data: {content: "..."}}` format.

---

#### POST /ai/chat/correct
Check grammar/vocabulary. **Auth:** Optional (Public) | **Rate Limit:** 5 req/min | **Request:** `{previous_ai_message, user_message, target_language, conversation_id?}` | **Response:** `{data: {corrected_text: "..." or null}}`

---

#### POST /ai/translate
Translate WORD or SENTENCE. **Auth:** Optional | **Rate Limit:** 5 req/min | **Request (WORD):** `{type: "WORD", text, source_lang, target_lang}` → **Response:** `{data: {translation, word, pronunciation}}` | **Request (SENTENCE):** `{type: "SENTENCE", message_id, source_lang, target_lang, conversation_id?}` → **Response:** `{data: {translated_content}}`

---

#### POST /ai/transcribe
Transcribe audio (M4A/MP4/MPEG/WAV, max 10MB). **Auth:** Required (Premium) | **Request:** multipart/form-data with `audio` field | **Response:** `{data: {text: "..."}}` | **Providers:** OpenAI Whisper → Gemini (fallback)

---

### Scenario Chat

Engage in roleplay conversations within scenario-based learning activities.

#### POST /scenario/chat
Roleplay in scenario. **Auth:** Required (Premium) | **Rate Limit:** 20 req/min, 100 req/hr | **Request:** `{scenario_id, message?, conversation_id?, force_new?}` | **Response:** `{data: {reply, conversation_id, turn, max_turns, completed}}` | **First turn:** omit message. **Resume:** provide conversation_id. **Re-practice:** force_new=true. **Errors:** 400, 401, 403, 404

#### GET /scenario/:scenarioId/conversations
List past conversations (newest first). **Auth:** Required | **Response:** `{data: {items: [{id, started_at, last_turn_at, turn_count, completed, max_turns}]}}` | Owner-filter only. No premium gate. **Errors:** 401

#### GET /scenario/conversations/:id
Fetch conversation transcript (owner only, chronological). **Auth:** Required | **Response:** `{data: {id, scenario_id, completed, turn, max_turns, messages: [{role, content, created_at}]}}` | **Errors:** 401, 403 (not owner), 404

---

### Vocabulary (Spaced Repetition & CRUD)

**Auth:** Required | **Rate Limit:** None (non-AI endpoint)

#### GET /vocabulary
List user's vocabulary for the active learning language. **Auth:** Required | **Header:** `X-Learning-Language: <code>` (preferred, determines `target_lang`) | **Query:** box (1-5), search, page (default 1), limit (default 20, max 100), `language_code` (legacy fallback only) | **Response:** `{data: {items: [{id, word, translation, source_lang, target_lang, part_of_speech, pronunciation, definition, examples, box, due_at, last_reviewed_at, review_count, correct_count, created_at}], total, page, limit}}`

---

#### GET /vocabulary/:id
Get a single vocabulary item. Same response shape as GET /vocabulary list items. **Errors:** 401, 404

---

#### DELETE /vocabulary/:id
Delete a vocabulary item.

**Response (204):** No content

**Errors:** 401 (unauthorized), 404 (not found or not owned)

---

#### POST /vocabulary/review/start
Start Leitner review session. **Auth:** Required | **Request:** `{language_code?, limit?}` (limit max 100, default 20) | **Response (201):** `{data: {session_id, cards: [{vocab_id, word, translation, pronunciation, part_of_speech, definition, examples, box, source_lang, target_lang}], total}}` | Session TTL: 1h. Cards ordered by box priority where due_at <= NOW().

---

#### POST /vocabulary/review/:sessionId/rate
Rate card (correct/incorrect). **Auth:** Required | **Request:** `{vocab_id, correct}` | **Response (201):** `{data: {updated: {box, due_at}, remaining}}` | **Leitner:** Box 1→2 (+3d), 2→3 (+7d), 3→4 (+14d), 4→5 (+30d), 5→5 (+30d). Wrong: any→1 (+1d). **Errors:** 400, 401, 403, 404

---

#### POST /vocabulary/review/:sessionId/complete
Complete review session (returns stats). **Auth:** Required | **Response (201):** `{data: {total, correct, wrong, accuracy, box_distribution: [{box, count}]}}` | Session deleted after completion. **Errors:** 401, 404

---

### Admin Content Management

All admin endpoints require `isAdmin` flag on user account (set via ADMIN_EMAILS env var bootstrap).

#### POST /admin/content/generate
Generate draft content via LLM. **Auth:** Required (Admin) | **Rate Limit:** 5 req/min | **Request:** `{language_id, type: SCENARIO|EXERCISE|LESSON, level: beginner|intermediate|advanced, count?: 1-10 default 5}` | **Response (201):** `{data: {generated: [{id, type, title, description, status: draft, language_id, level, created_at}], count}}` | **Errors:** 400, 401, 403, 429, 503

---

#### GET /admin/content
List content with filters. **Auth:** Required (Admin) | **Query:** status (draft|published|archived), type, language_id, page (1+), limit (1-100, default 20) | **Response:** `{data: {items: [{id, type, title, description, status, language_id, language_code, level, created_at, updated_at}], pagination}}`

---

#### PATCH /admin/content/:id/publish
Publish draft content. **Auth:** Required (Admin) | **Query:** type (LESSON|EXERCISE|SCENARIO) | **Response:** `{data: {id, status: published, updated_at}}` | Idempotent. **Errors:** 400, 401, 404

---

#### PATCH /admin/content/:id
Edit content (title/description only). **Auth:** Required (Admin) | **Query:** type | **Request:** `{title?, description?}` (title max 255 chars, description max 5000) | **Response:** `{data: {id, status, updated_at}}` | **Errors:** 400, 401, 404

---

#### DELETE /admin/content/:id
Archive content (soft delete). **Auth:** Required (Admin) | **Query:** type | **Response:** `{data: {id, status: archived, updated_at}}` | Idempotent. **Errors:** 400, 401, 404

---

### Admin KOL Bundle Management

#### POST /admin/kol-bundles
Create a new KOL bundle with gift code and scenarios. **Auth:** Required (Admin role) | **Request:** `{name: "string", description?: "string", gift_code: "string", scenario_ids: ["uuid1", "uuid2"]}` | **Response (201):** `{code: 1, message: "Bundle created", data: {id, name, gift_code, scenario_count, created_at}}`

**Role:** Admin-only (checked via `@Roles('admin')` decorator on RolesGuard). Gift code must be unique. Scenarios must exist. **Errors:** 401, 403 (not admin), 400 (validation), 409 (duplicate code)

---

#### GET /admin/kol-bundles
List all KOL bundles (paginated). **Auth:** Required (Admin role) | **Query:** `page` (1+, default 1), `limit` (1-100, default 20) | **Response (200):** `{code: 1, message: "Bundles found", data: {items: [{id, name, gift_code, scenario_count, created_at}], total, page, limit}}`

**No filter logic.** Lists all bundles across all languages. **Errors:** 401, 403 (not admin)

---

#### POST /admin/kol-bundles/:id/scenarios
Attach scenarios to an existing bundle. **Auth:** Required (Admin role) | **Request:** `{scenario_ids: ["uuid1", "uuid2"]}` | **Response (200):** `{code: 1, message: "Scenarios attached", data: {bundle_id, attached_count, total_scenarios}}`

**Idempotent:** Re-attaching same scenarios succeeds without duplicates (database unique constraint on (bundle_id, scenario_id)). **Errors:** 401, 403 (not admin), 404 (bundle not found), 400 (scenario not found)

---

### Onboarding (No Auth Required)

#### POST /onboarding/chat
Start new or resume session. **Auth:** Not required | **Rate Limit:** 5 req/hr (new), 30 req/hr (continue) | **New:** `{native_language, target_language}` → Response: `{data: {conversation_id, reply, message_id, turn_number, is_last_turn}}` | **Resume:** `{conversation_id, message?}` → Same response. Max 10 turns/session. **Errors:** 400, 429, 404, 503

---

#### GET /onboarding/conversations/:conversationId/messages
Fetch transcript for mobile rehydration. **Auth:** Not required | **Rate Limit:** 30 req/hr per IP | **Response:** `{data: {conversation_id, turn_number, max_turns, is_last_turn, messages: [{id, role, content, created_at}]}}` | **Errors:** 404

#### POST /onboarding/complete
Extract onboarding profile (idempotent, caches on first success). **Auth:** Not required | **Request:** `{conversation_id}` | **Response:** `{data: {extracted_profile: {languages, interests, level}}}`

---

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| 200 | OK | Request successful |
| 201 | Created | Resource created |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource exists |
| 500 | Server Error | Internal error |
| 503 | Service Unavailable | External service down |

## Rate Limiting

**AI Endpoints:**
- Free users: 100 requests/hour
- Premium users: 1000 requests/hour
- Per-user rate limiting enforced

## CORS Configuration

**Allowed Origins:** Via CORS_ALLOWED_ORIGINS env var

**Allowed Methods:** GET, POST, PATCH, DELETE, OPTIONS

**Allowed Headers:** Authorization, Content-Type

## Webhook Security

**RevenueCat:** Bearer token in Authorization header with timing-safe comparison

## Example Requests

**cURL - Firebase sign-in:**
```bash
curl -X POST http://localhost:3000/auth/firebase \
  -H "Content-Type: application/json" \
  -d '{"id_token":"<firebase_id_token>","display_name":"Jane"}'
```

**cURL Examples (see Swagger at `/api/docs` for more):**
```bash
# Get profile
curl http://localhost:3000/users/me -H "Authorization: Bearer YOUR_JWT_TOKEN"

# AI chat
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","context":{"conversation_id":"uuid","target_language":"Spanish"}}'

# Scenario chat (first turn)
curl -X POST http://localhost:3000/scenario/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"scenario_id":"550e8400-e29b-41d4-a716-446655440000"}'
```

## Interactive Documentation

**Swagger UI:** Available at `/api/docs` in development mode
- Interactive API testing
- Request/response examples
- Schema definitions
- Authentication testing

Access: `http://localhost:3000/api/docs`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Verify JWT token valid/not expired; check `Authorization: Bearer <token>` format |
| 400 Bad Request | Verify body schema, required fields, data types |
| 503 Service Unavailable | Check AI provider API keys; review Langfuse logs |

**More:** Swagger at `/api/docs` for interactive testing.
