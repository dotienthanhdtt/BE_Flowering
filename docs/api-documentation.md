# API Documentation

**Last Updated:** 2026-05-13
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

#### Snake_case Exception: Scenario Chat
`POST /scenario/chat`, `GET /scenario/conversations/:id`, and `GET /scenario/:scenarioId/conversations` emit snake_case keys in the response (`conversation_id`, `max_turns`, `turn`, `created_at`, etc.). All other endpoints remain camelCase in the response.

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
    "active_language": "es",
    "created_at": "2026-03-01T10:00:00.000Z",
    "onboarding_required": false,
    "missing_fields": []
  }
}
```

`onboarding_required` is `true` when any of `native_language`, `user_languages` row, or onboarding chat profile extraction is missing. Mobile MUST gate the post-login route on this flag — do not reimplement the rule client-side. `missing_fields` lists which artifacts are absent: `nativeLanguage`, `userLanguage`, `onboardingProfile`.

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
Get lessons grouped by category. **Auth:** Required | **Query:** language (uuid), search (string), page (1+), limit (1-50, default 20).

**Response:** `{data: {categories: [{id, name, scenarios: [{id, title, image_url, status}]}], pagination}}`

**Status:** available | locked (premium, free user) | learned. **Visibility:** published + (global OR matching language OR user_scenario_access). **Errors:** 400, 401

---

### Scenarios

#### GET /scenarios
List all available scenarios grouped by category for active language (paginated by category). **Auth:** Required | **Header:** `X-Learning-Language: <code>` (required) | **Query:** `page` (1+, default 1), `limit` (1-50, default 20) | **Response (200):**
```json
{
  "code": 1,
  "message": "Scenarios found",
  "data": {
    "items": [
      {
        "category": {
          "id": "uuid",
          "name": "Restaurant",
          "slug": "restaurant",
          "orderIndex": 1
        },
        "scenarios": [
          {
            "id": "uuid",
            "title": "Ordering Food",
            "description": "Learn to order at a cafe",
            "imageUrl": "https://...",
            "languageId": "uuid",
            "type": "system|kol|personal",
            "source": "system|kol|personalized",
            "addedAt": "2026-05-16T...",
            "locked": false
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45
    }
  }
}
```

**Behavior:** Returns all visible scenarios (system, KOL-granted, personal) grouped by language-scoped category. Empty categories are hidden. Categories sorted by `orderIndex ASC`. Within each category, scenarios sorted by `COALESCE(grantedAt, addedAt) DESC`. Premium scenarios return `locked=true` (omit description/imageUrl). Automatically enrolls user in language. **Errors:** 400 (missing header), 401 (unauthorized), 403 (inactive language)

---

#### POST /scenarios/redeem
Redeem a KOL gift code to grant access to scenarios. **Auth:** Required | **Rate Limit:** 5 req/min | **Request:** `{gift_code: "string"}` | **Response (200):** `{code: 1, message: "Scenarios redeemed", data: {redeemed_count: int, scenarios: [{id, title}]}}`

**Behavior:** Validates gift code exists + is active in KolBundle. For each bundle scenario, creates UserAiScenario row if user doesn't already have access. Idempotent (duplicate codes succeed without double-grants). **Errors:** 404 (code not found), 400 (invalid), 429 (throttled)

---

#### GET /scenarios/:id
Get full scenario detail including access state. **Auth:** Required | **Header:** `X-Learning-Language: <code>` (required) | **Path:** `id` (uuid)

**Response (200):** `{code: 1, message: "...", data: {id, title, description?, imageUrl?, languageId, orderIndex, category: {id, name}, accessTier, isLocked, lockReason?}}`

**Soft-lock behavior:** Premium scenarios return `isLocked=true, lockReason="premium_required"` instead of 403, enabling mobile upgrade CTA in a single round-trip. **Errors:** 401, 404 (not found / wrong language / unpublished)

Sample responses:
```json
// FREE tier — 200
{"code":1,"data":{"id":"uuid","title":"Ordering Food","description":"Learn how to order at a restaurant","languageId":"uuid","orderIndex":1,"category":{"id":"uuid","name":"Restaurant"},"accessTier":"free","isLocked":false}}

// PREMIUM, no subscription — 200
{"code":1,"data":{"id":"uuid","title":"Luxury Hotel","description":"Practice checking into a 5-star hotel","languageId":"uuid","orderIndex":5,"category":{"id":"uuid","name":"Hotel"},"accessTier":"premium","isLocked":true,"lockReason":"premium_required"}}

// PREMIUM, active subscription — 200
{"code":1,"data":{"id":"uuid","title":"Luxury Hotel","description":"Practice checking into a 5-star hotel","languageId":"uuid","orderIndex":5,"category":{"id":"uuid","name":"Hotel"},"accessTier":"premium","isLocked":false}}

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

#### POST /ai/translate/word
Resolve and translate the smallest meaning-bearing chunk at a tapped position in a chat message. **Auth:** Required | **Rate Limit:** 5 req/60s | **Request:**
```json
{
  "message_id": "uuid",
  "source_lang": "en",
  "target_lang": "vi",
  "tap_from": 4,
  "tap_to": 9
}
```

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "text": "going",
    "type": "word|phrase|idiom|phrasal_verb|compound_noun|particle|article|fixed_expression",
    "from": 4,
    "to": 9,
    "translation": "đi",
    "pronunciation": "ɡoʊ.ɪŋ",
    "vocabulary_id": "uuid"
  }
}
```

**Behavior:**
- Resolves the exact chunk at character positions [tap_from, tap_to) in the message
- LLM identifies the smallest grammatically complete unit (word, phrase, idiom, etc.)
- Translates the resolved chunk
- Upserts to Vocabulary table with chunk type for future reference
- Anonymous users (no auth) return 401

**Error Cases:**
- **400** (Bad Request): Invalid tap range (tap_from < 0, tap_to <= tap_from, or tap_to > message length)
- **401** (Unauthorized): Missing or invalid JWT token
- **403** (Forbidden): Caller does not own the message's conversation
- **404** (Not Found): Message ID not found

**Chunk Type Values:**
- `word` — single morpheme unit (e.g., "run", "going")
- `phrase` — multi-word collocation (e.g., "take care of")
- `idiom` — fixed expression (e.g., "piece of cake")
- `phrasal_verb` — verb + particle(s) (e.g., "look up")
- `compound_noun` — noun compound (e.g., "coffee table")
- `particle` — grammatical particle (e.g., "to" in infinitive)
- `article` — article (e.g., "a", "the")
- `fixed_expression` — formulaic sequence (e.g., "nice to meet you")

---

#### POST /ai/transcribe
Transcribe audio (M4A/MP4/MPEG/WAV, max 10MB). **Auth:** Required (Premium) | **Request:** multipart/form-data with `audio` field | **Response:** `{data: {text: "..."}}` | **Providers:** OpenAI Whisper → Gemini (fallback)

---

### Scenario Chat

Engage in roleplay conversations within scenario-based learning activities. Uses snake_case in response fields (see **Snake_case exception** note below).

#### POST /scenario/chat
Roleplay in scenario. **Auth:** Required (Premium) | **Rate Limit:** 20 req/min, 100 req/hr per user | **Request:** `{scenario_id, message?, conversation_id?, force_new?}` | **Response (200):** `{code: 1, message: "Success", data: {scenario: {conversation_id, max_turns, turn, status}, messages: [{id, role, content, created_at}]}}` | **First turn:** omit message. **Resume:** provide conversation_id. **Re-practice:** force_new=true. **Errors:** 400, 401, 403, 404

**Response Details:**
- `scenario.status`: enum `"CHATTING"` (in progress) or `"DONE"` (completed)
- Status is `"DONE"` when: max_turns reached (hard-end) OR LLM emits `is_end: true` in JSON reply (soft-end)
- `messages`: sorted chronologically (oldest first), includes both user and assistant messages
- All timestamps in ISO 8601 format

**Example Response:**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "scenario": {
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "max_turns": 12,
      "turn": 1,
      "status": "CHATTING"
    },
    "messages": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "role": "assistant",
        "content": "Welcome to the restaurant scenario!",
        "created_at": "2026-04-25T10:00:00.000Z"
      },
      {
        "id": "660e8400-e29b-41d4-a716-446655440002",
        "role": "user",
        "content": "Hello, I'd like a table for two",
        "created_at": "2026-04-25T10:00:01.000Z"
      }
    ]
  }
}
```

#### GET /scenario/:scenarioId/conversations
List user's past conversations for a scenario (newest first). **Auth:** Required | **Response (200):** `{code: 1, message: "...", data: {items: [{id, startedAt, lastTurnAt, turnCount, status, maxTurns}]}}` | Owner-filter only. No premium gate. **Errors:** 401, 404

**Response Details:**
- `status`: enum `"CHATTING"` or `"DONE"`
- `turnCount`: number of completed user/assistant turn pairs

#### GET /scenario/conversations/:id
Fetch conversation transcript (owner only, chronological). **Auth:** Required | **Response (200):** `{code: 1, message: "...", data: {scenario: {conversation_id, max_turns, turn, status}, messages: [{id, role, content, created_at}]}}` | **Errors:** 401, 403 (not owner), 404

**Response Details:**
- Same response shape as `POST /scenario/chat`
- Messages ordered chronologically (oldest first)

---

#### POST /scenario/complete
Finalize a scenario conversation: flip status to DONE, run LLM evaluation (optional), persist evaluation result, trigger personalization. **Auth:** Required (Premium) | **Header:** `X-Learning-Language: <code>` (required) | **Rate Limit:** 30 req/min (`scenario-complete` bucket) | **Request:**
```json
{
  "scenario_id": "uuid",
  "conversation_id": "uuid"
}
```

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "scenario": {
      "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
      "max_turns": 12,
      "turn": 10,
      "status": "DONE"
    },
    "messages": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "role": "assistant",
        "content": "Welcome to the restaurant scenario!",
        "created_at": "2026-04-25T10:00:00.000Z"
      }
    ],
    "evaluation": {
      "overall_score": 82,
      "fluency_score": 80,
      "accuracy_score": 85,
      "vocab_score": 78,
      "strengths": ["Good pronunciation", "Natural pacing"],
      "improvements": ["More complex sentence structures"],
      "summary": "Strong conversational performance with room for advanced vocabulary"
    },
    "evaluation_error": null
  }
}
```

**Behavior:**
- Marks conversation status as DONE (idempotent via UNIQUE constraint on conversation_id)
- Runs synchronous LLM evaluation against transcript + injected vocabulary
- Evaluation fields included only if assessment succeeds; on LLM failure, `evaluation: null` and `evaluation_error` contains reason
- Triggers personalization rules (AI scenario generation, profile updates) on success
- Supports IDOR protection: caller must own the conversation
- Returns 200 + `evaluation: null, evaluation_error: 'timeout'` if LLM times out (15s limit)

**Evaluation Whitelist (response only):**
- `overall_score` (0–100)
- `fluency_score` (0–100)
- `accuracy_score` (0–100)
- `vocab_score` (0–100)
- `strengths` (string array)
- `improvements` (string array)
- `summary` (string)

Internal fields (`model_used`, `prompt_version`, `user_id`, etc.) excluded from response.

**Error Cases:**
- 400 (Bad Request): Missing or invalid UUIDs
- 401 (Unauthorized): Missing/invalid JWT token
- 403 (Forbidden): Caller does not own the conversation
- 404 (Not Found): Conversation or scenario not found
- 500: Rare; LLM provider outage (unlikely with async retry fallback)

**Example cURL:**
```bash
curl -X POST http://localhost:3000/scenario/complete \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-Learning-Language: es" \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "550e8400-e29b-41d4-a716-446655440000",
    "conversation_id": "550e8400-e29b-41d4-a716-446655440001"
  }'
```

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
Extract onboarding profile + scenarios (idempotent, caches on first success). **Auth:** Not required | **Request:** `{conversation_id}` | **Response:** `{data: {extracted_profile: {languages, interests, level}, scenarios: [{id, title, description}]}}`

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

## WebSocket: /ws/speech/stt

Realtime streaming speech-to-text. Mobile streams raw PCM 16-bit 16 kHz mono frames over WebSocket; backend proxies to Soniox and returns partial/final transcripts. Audio archived to Railway bucket.

### Connection

```
ws://host/ws/speech/stt?context=<scenario|onboarding>&traceId=<uuid>&lang=<iso>&token=<jwt>
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `context` | yes | `scenario` (JWT auth) or `onboarding` (sessionId auth) |
| `traceId` | recommended | UUID v4 minted by client — links STT span + downstream LLM call in Langfuse |
| `lang` | no | ISO 639-1 language hint (e.g. `en`, `vi`) |
| `token` | scenario only | JWT bearer token (alternatively in `Authorization: Bearer` header) |
| `sessionId` | onboarding only | Onboarding session identifier |

### Auth

- **scenario**: JWT via `Authorization: Bearer <token>` header **or** `?token=<jwt>` query param.
- **onboarding**: `?sessionId=<id>` query param (min 8 chars). No JWT required.
- Failure → server sends `{type:"error",code:"auth"}` then closes with code **4401**.

### Message Flow

```
Client → Server                     Server → Client
──────────────────────────────────────────────────────
[binary PCM frames]          →
                             ←      {type:"partial", text:"..."}
                             ←      {type:"final", text:"..."}
{type:"end"}                 →
                             ←      {type:"session_end", transcript:"...", audioUrl:"...", traceId:"..."}
                                    [connection closes 1000]
```

### Server → Client Message Shapes

```ts
type ServerMsg =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "session_end"; transcript: string; audioUrl: string | null; traceId: string }
  | { type: "error"; code: "max_duration"|"overflow"|"provider"|"auth"|"concurrent"; message: string }
```

### WebSocket Close Codes

| Code | Reason |
|------|--------|
| 1000 | Normal close after `session_end` |
| 4401 | Unauthorized |
| 4408 | Max duration (3 min) exceeded |
| 4413 | Audio buffer overflow (> 5.76 MB) |
| 4429 | Concurrent session already active for this principal |
| 4500 | Provider (Soniox) error |

### Audio Format

Raw PCM frames: **16-bit signed, 16 kHz, mono**. No headers. Frame size is flexible (suggest 4 KB chunks).

### Example (`wscat`)

```bash
# Connect (scenario)
wscat -c "ws://localhost:3000/ws/speech/stt?context=scenario&traceId=<uuid>&token=<jwt>"

# Send end signal
> {"type":"end"}

# Receive
< {"type":"session_end","transcript":"Hello world","audioUrl":"https://...","traceId":"<uuid>"}
```

## POST /ai/speech/tts (scenario)

Synthesize an assistant chat message to mp3. JWT-protected. Looks up the message by `messageId`, verifies ownership (`conversation.userId === jwt.sub`), and returns a presigned URL.

### Auth
JWT Bearer.

### Request
```json
{ "messageId": "<uuid>" }
```

### Response
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "audioUrl": "https://...signed-mp3-url",
    "mimeType": "audio/mpeg",
    "cached": false
  }
}
```

`cached: true` indicates a DB hit — TTS provider was not called; URL is freshly re-signed.

### Errors
| Status | Reason |
|--------|--------|
| 400 | Message exceeds 5000-char limit |
| 403 | Message is not an assistant message OR conversation is not yours |
| 404 | Message not found |
| 502 | TTS provider error (primary or fallback) |

## POST /ai/speech/tts/onboarding (public)

Same as above for anonymous onboarding chat. No JWT — verifies `(conversationId, sessionId)` and that the conversation is onboarding-type (`anonymous` / `personalize_intake`) with no linked user.

### Request
```json
{
  "messageId": "<uuid>",
  "conversationId": "<uuid>",
  "sessionId": "<uuid>"
}
```

Response shape identical to the scenario endpoint.

## WebSocket: /ws/speech/tts

Realtime streaming TTS. Backend opens a TTS WebSocket connection (Soniox primary, Alibaba fallback) and proxies audio chunks (mp3 or pcm_s16le by default) to the client as binary frames. Synthesized audio is persisted to storage on first run so subsequent calls hit the DB cache.

### Connection
```
ws://host/ws/speech/tts?context=<scenario|onboarding>&messageId=<uuid>&token=<jwt>
ws://host/ws/speech/tts?context=onboarding&messageId=<uuid>&conversationId=<uuid>&sessionId=<uuid>
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `context` | yes | `scenario` (JWT) or `onboarding` (sessionId) |
| `messageId` | yes | Assistant message UUID to synthesize |
| `conversationId` | onboarding only | Conversation the message belongs to |
| `sessionId` | onboarding only | Onboarding session identifier |
| `token` | scenario only | JWT bearer (alternatively `Authorization: Bearer`) |

### Message Flow
```
Client → Server                     Server → Client
──────────────────────────────────────────────────────
[connect]                    →
                             ←      [binary mp3 chunks ...]
                             ←      {type:"session_end", first_chunk_ms: 240, total_bytes: 31480}
                                    [connection closes 1000]
```

### Close Codes
| Code | Reason |
|------|--------|
| 1000 | Normal close after `session_end` |
| 4400 | Bad request (missing/invalid messageId or conversationId) |
| 4401 | Unauthorized |
| 4403 | Forbidden (not your message / wrong conversation / not an onboarding session) |
| 4404 | Message not found |
| 4408 | Max duration (60s) exceeded |
| 4413 | Message exceeds 5000-char limit |
| 4500 | TTS provider error (primary or fallback) |

### Trace Continuity

Mobile mints one `traceId` UUID per voice turn:
1. Passes `?traceId=<uuid>` to WS — creates `stt.session` event in Langfuse under that session.
2. Passes `traceId` in the subsequent `POST /onboarding/chat` or `POST /scenario/chat` body — LLM call shares the same Langfuse session.

Result: a single Langfuse session shows both STT and LLM spans for one voice turn.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Verify JWT token valid/not expired; check `Authorization: Bearer <token>` format |
| 400 Bad Request | Verify body schema, required fields, data types |
| 503 Service Unavailable | Check AI provider API keys; review Langfuse logs |
| WS 4401 | Check `context` param and auth (JWT or sessionId) |
| WS 4429 | Previous session still active — wait for `session_end` or reconnect after disconnect |

**More:** Swagger at `/api/docs` for interactive testing.
