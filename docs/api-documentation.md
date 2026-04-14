# API Documentation

**Last Updated:** 2026-04-14
**Base URL:** `http://localhost:3000` (development)
**API Version:** 1.8.0

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

#### POST /auth/register
> **DISABLED — returns 410 Gone.** Email/password auth is soft-disabled. Use `POST /auth/firebase` instead.

Register new user account.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response (410):** `{code: 0, message: "Email/password authentication is no longer supported", data: null}`

---

#### POST /auth/login
> **DISABLED — returns 410 Gone.** Use `POST /auth/firebase` instead.

Login with email and password.

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

#### POST /auth/forgot-password
> **DISABLED — returns 410 Gone.** Use `POST /auth/firebase` instead.

Request password reset via OTP.

**Auth:** Not required | **Response (410):** `{code: 0, message: "Email/password authentication is no longer supported", data: null}`

---

#### POST /auth/verify-otp
> **DISABLED — returns 410 Gone.** Use `POST /auth/firebase` instead.

**Auth:** Not required | **Response (410):** `{code: 0, message: "Email/password authentication is no longer supported", data: null}`

---

#### POST /auth/reset-password
> **DISABLED — returns 410 Gone.** Use `POST /auth/firebase` instead.

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

**Auth:** Required | **Response (200):** `{code: 1, message: "User languages found", data: [{id, language: {...}, proficiency_level, is_active}]}`

---

#### POST /languages/user
Add language to the caller's learning list.

**Auth:** Required | **Request:**
```json
{
  "language_id": "uuid",
  "proficiency_level": "beginner|intermediate|advanced|native"
}
```

**Response (201):** `{code: 1, message: "Language added", data: {...}}`

---

#### PATCH /languages/user/:languageId
Update language proficiency.

**Auth:** Required | **Request:**
```json
{
  "proficiency_level": "intermediate"
}
```

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
Get home screen lessons grouped by category with filtering.

**Auth:** Required | **Query params:**
- `language` (optional, UUID) — Filter by specific language
- `level` (optional, enum: beginner|intermediate|advanced) — Filter by difficulty
- `search` (optional, string) — Search scenario title (case-insensitive)
- `page` (optional, integer, min: 1, default: 1) — Page number
- `limit` (optional, integer, min: 1, max: 50, default: 20) — Items per page

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "categories": [
      {
        "id": "uuid",
        "name": "Greetings",
        "scenarios": [
          {
            "id": "uuid",
            "title": "Meet & Greet",
            "image_url": "url or null",
            "difficulty": "beginner",
            "status": "available"
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

**Scenario Status Values:**
- `available` — Scenario is accessible
- `trial` — Trial scenario (free users only)
- `locked` — Premium scenario (requires active subscription)
- `learned` — User has completed scenario

**Visibility Rules:**
- Global scenarios (language_id = NULL) visible to all users
- Language-specific scenarios visible only if matching user's requested language
- User-granted scenarios (via user_scenario_access table) always visible
- Only active scenarios (is_active = true) returned
- Empty categories excluded from response

**Errors:** 400 (invalid query params), 401 (unauthorized)

---

### AI Features

Chat endpoint requires active premium subscription. Translation and correction endpoints are public but support optional premium. Use `@RequirePremium()` decorator with PremiumGuard for enforcement.

#### POST /ai/chat
Chat with AI tutor.

**Auth:** Required (Premium) | **Rate Limit:** default global throttler | **Request:**
```json
{
  "message": "How do I use the past tense in Spanish?",
  "context": {
    "conversation_id": "uuid",
    "target_language": "Spanish",
    "native_language": "English",
    "proficiency_level": "beginner",
    "lesson_topic": "Past tense"
  },
  "model": "gpt-4o"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| message | string | Yes | User message (max 4000 chars) |
| context.conversation_id | UUID | Yes | Conversation session id |
| context.target_language | string | Yes | Language being learned |
| context.native_language | string | Yes | User's native language |
| context.proficiency_level | string | Yes | `beginner|elementary|intermediate|upper-intermediate|advanced` |
| context.lesson_topic | string | No | Current lesson topic |
| model | enum | No | Override default LLM (see `LLMModel` enum) |

**Response (200):** `{code: 1, message: "Success", data: {message, conversation_id}}`

---

#### SSE /ai/chat/stream
Stream chat response (Server-Sent Events).

**Auth:** Required (Premium) | **Request:** Same shape as `POST /ai/chat`

**Response:** text/event-stream. Each event payload: `{ "data": { "content": "<chunk>" } }`.

---

#### POST /ai/chat/correct
Check grammar/vocabulary of user's chat reply in context of previous AI message.

**Auth:** Optional (Public) | **Rate Limit:** 5 req/min | **Request:**
```json
{
  "previous_ai_message": "How was your weekend?",
  "user_message": "I go to park yesterday",
  "target_language": "en",
  "conversation_id": "optional-uuid"
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| previous_ai_message | string | Yes | 4000 chars | AI tutor's previous message (context) |
| user_message | string | Yes | 4000 chars | User's reply to check |
| target_language | string | Yes | 10 chars | Target language code (e.g., "en", "ja", "vi") |
| conversation_id | UUID | No | - | Optional conversation context |

**Response (200) — errors found:** `{code: 1, message: "Success", data: {corrected_text: "I went to the park yesterday."}}`

**Response (200) — no errors:** `{code: 1, message: "Success", data: {corrected_text: null}}`

**Errors:** 400 (missing/empty fields), 429 (rate limit)

---

#### POST /ai/translate
Translate words or sentences with vocabulary persistence for words.

**Auth:** Optional (Public) | **Rate Limit:** 5 req/min | **Request:**
```json
{
  "type": "WORD",
  "text": "beautiful",
  "source_lang": "en",
  "target_lang": "es"
}
```

**OR (sentence translation by messageId):**
```json
{
  "type": "SENTENCE",
  "message_id": "uuid",
  "source_lang": "en",
  "target_lang": "es",
  "conversation_id": "optional_conversation_id"
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| type | enum | Yes | - | `WORD` or `SENTENCE` |
| text | string | No | 255 chars | Word/phrase to translate (WORD only) |
| message_id | UUID | No | - | Conversation message ID (SENTENCE only) |
| source_lang | string | Yes | 10 chars | Source language code (e.g., "en", "ja") |
| target_lang | string | Yes | 10 chars | Target language code (e.g., "es", "vi") |
| conversation_id | UUID | No | - | Optional conversation ID for anonymous users |

**Response (200) — word translation:** `{code: 1, message: "Success", data: {translation: "hermoso", word: "beautiful", pronunciation: "er-MO-so"}}`

**Response (200) — sentence translation:** `{code: 1, message: "Success", data: {translated_content: "Eso es hermoso."}}`

**Errors:** 400 (invalid type/missing fields), 404 (message not found), 429 (rate limit)

---

#### POST /ai/transcribe
Transcribe audio to text using Speech-to-Text (STT) services.

**Auth:** Required (Premium) | **Request:** multipart/form-data

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| audio | file | Yes | 10MB | Audio file (M4A, MP4, MPEG, WAV) |

**cURL Example:**
```bash
curl -X POST http://localhost:3000/ai/transcribe \
  -H "Authorization: Bearer <jwt_token>" \
  -F "audio=@/path/to/audio.m4a"
```

**Supported Audio Formats:** M4A, MP4, MPEG, WAV (max 10MB)

**Response (200):** `{code: 1, message: "Success", data: {text: "Hello, how are you?"}}`

**Provider Details:**
- **Primary:** OpenAI Whisper (configurable via STT_PROVIDER=openai)
- **Fallback:** Gemini multimodal (if primary unavailable)
- **Configuration:** STT_PROVIDER env var (default: openai)

**Audio Storage:** Audio files persisted to Supabase storage before transcription

**Errors:** 
- 400 (missing file, unsupported format, exceeds size limit)
- 401 (unauthorized, not premium)
- 429 (rate limit)
- 503 (no STT provider available)

---

### Scenario Chat

Engage in roleplay conversations within scenario-based learning activities.

#### POST /scenario/chat
Conduct a turn in a scenario roleplay conversation.

**Auth:** Required (Premium) | **Rate Limit:** 20 req/min, 100 req/hr | **Request:**
```json
{
  "scenario_id": "uuid",
  "message": "I need a table for two",
  "conversation_id": "uuid",
  "force_new": false
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| scenario_id | UUID | Yes | - | ID of scenario to engage with |
| message | string | No | 2000 chars | User's roleplay response (omit on first turn to let AI open) |
| conversation_id | UUID | No | - | Conversation ID to resume existing session |
| force_new | boolean | No | - | Abandon any active conversation for this scenario and start fresh. Cannot combine with `conversation_id`. |

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "reply": "Of course! A table for two right away. This way, please.",
    "conversation_id": "uuid",
    "turn": 1,
    "max_turns": 12,
    "completed": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| reply | string | AI roleplay response |
| conversation_id | UUID | Conversation session ID |
| turn | number | Current turn number (1-based) |
| max_turns | number | Maximum turns for this conversation |
| completed | boolean | True when max turns reached |

**Behavior:**
- First turn: Omit `message` parameter; AI initiates the roleplay
- Subsequent turns: Include `message` parameter
- Resume conversation: Provide `conversation_id` from previous turn
- Conversation ends when `completed: true`
- Re-practice: send `force_new: true` to abandon the active conversation and start fresh
- Premium subscription required

**Errors:**
- 400 (conversation completed, invalid body, scenario not found, or `force_new` combined with `conversation_id`)
- 401 (missing/invalid JWT)
- 403 (free user trying premium scenario)
- 404 (scenario not found)

#### GET /scenario/:scenarioId/conversations
List the caller's past conversations for one scenario (newest first).

**Auth:** Required | **Rate Limit:** none (non-AI endpoint)

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "items": [
      {
        "id": "uuid",
        "started_at": "2026-04-14T09:00:00.000Z",
        "last_turn_at": "2026-04-14T09:15:00.000Z",
        "turn_count": 5,
        "completed": false,
        "max_turns": 12
      }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Conversation id |
| started_at | ISO date | When the conversation was created |
| last_turn_at | ISO date | Timestamp of the most recent activity |
| turn_count | number | Completed user/assistant turn pairs so far |
| completed | boolean | True when the turn cap has been reached |
| max_turns | number | Turn cap for this conversation |

**Behavior:**
- Owner-filter only: returns only conversations owned by the caller
- No premium gate: downgraded users can still review their own history
- Empty array when the user has never engaged with the scenario

**Errors:**
- 401 (missing/invalid JWT)

#### GET /scenario/conversations/:id
Fetch a single conversation transcript (owner only).

**Auth:** Required | **Rate Limit:** none (non-AI endpoint)

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "id": "uuid",
    "scenario_id": "uuid",
    "completed": true,
    "turn": 12,
    "max_turns": 12,
    "messages": [
      { "role": "assistant", "content": "Welcome!", "created_at": "2026-04-14T09:00:00.000Z" },
      { "role": "user", "content": "Thanks", "created_at": "2026-04-14T09:00:05.000Z" }
    ]
  }
}
```

**Behavior:**
- Owner-check: 403 if the conversation belongs to another user
- Returns full transcript in chronological order
- Filters out any `system` role messages

**Errors:**
- 401 (missing/invalid JWT)
- 403 (conversation owned by another user)
- 404 (conversation not found)

---

### Vocabulary (Spaced Repetition & CRUD)

**Auth:** Required | **Rate Limit:** None (non-AI endpoint)

#### GET /vocabulary
List user's vocabulary with optional filters and pagination.

**Query params:**
- `language_code` (optional) — Filter by source/target language (e.g., "en", "es")
- `box` (optional, 1-5) — Filter by Leitner box number
- `search` (optional) — Search word or translation (substring)
- `page` (optional, default: 1) — Page number
- `limit` (optional, default: 20, max: 100) — Items per page

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "items": [
      {
        "id": "uuid",
        "word": "beautiful",
        "translation": "hermoso",
        "source_lang": "en",
        "target_lang": "es",
        "part_of_speech": "adjective",
        "pronunciation": "byoo-tuh-fuhl",
        "definition": "pleasing to look at",
        "examples": ["It was a beautiful day.", "She looked beautiful."],
        "box": 2,
        "due_at": "2026-04-15T10:00:00Z",
        "last_reviewed_at": "2026-04-12T10:00:00Z",
        "review_count": 5,
        "correct_count": 4,
        "created_at": "2026-03-28T10:00:00Z"
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

**Errors:** 401 (unauthorized)

---

#### GET /vocabulary/:id
Get a single vocabulary item.

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "id": "uuid",
    "word": "beautiful",
    "translation": "hermoso",
    "source_lang": "en",
    "target_lang": "es",
    "part_of_speech": "adjective",
    "pronunciation": "byoo-tuh-fuhl",
    "definition": "pleasing to look at",
    "examples": ["It was a beautiful day."],
    "box": 2,
    "due_at": "2026-04-15T10:00:00Z",
    "last_reviewed_at": "2026-04-12T10:00:00Z",
    "review_count": 5,
    "correct_count": 4,
    "created_at": "2026-03-28T10:00:00Z"
  }
}
```

**Errors:** 401 (unauthorized), 404 (not found or not owned)

---

#### DELETE /vocabulary/:id
Delete a vocabulary item.

**Response (204):** No content

**Errors:** 401 (unauthorized), 404 (not found or not owned)

---

#### POST /vocabulary/review/start
Start a Leitner SRS review session. Returns due vocabulary cards for review.

**Auth:** Required | **Request:**
```json
{
  "language_code": "en",
  "limit": 10
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| language_code | string | No | 10 chars | Filter cards by language; defaults to all |
| limit | number | No | max 100 | Max cards per session (default: 20) |

**Response (201):**
```json
{
  "code": 1,
  "message": "Session started",
  "data": {
    "session_id": "session-uuid-1234",
    "cards": [
      {
        "vocab_id": "uuid",
        "word": "beautiful",
        "translation": "hermoso",
        "pronunciation": "byoo-tuh-fuhl",
        "part_of_speech": "adjective",
        "definition": "pleasing to look at",
        "examples": ["It was a beautiful day."],
        "box": 1,
        "source_lang": "en",
        "target_lang": "es"
      }
    ],
    "total": 3
  }
}
```

**Behavior:**
- Session TTL: 1 hour
- Returns cards where `due_at <= NOW()` ordered by box priority
- Session ID used for rating and completion endpoints

**Errors:** 401 (unauthorized)

---

#### POST /vocabulary/review/:sessionId/rate
Rate a card in a review session (correct/incorrect).

**Auth:** Required | **Request:**
```json
{
  "vocab_id": "uuid",
  "correct": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| vocab_id | UUID | Yes | Vocabulary ID from session cards |
| correct | boolean | Yes | true = correct, false = incorrect |

**Response (201):**
```json
{
  "code": 1,
  "message": "Card rated",
  "data": {
    "updated": {
      "box": 2,
      "due_at": "2026-04-15T10:00:00Z"
    },
    "remaining": 2
  }
}
```

**Leitner Transitions:**
| From Box | Correct | New Box | Interval |
|----------|---------|---------|----------|
| 1 | yes | 2 | +3 days |
| 2 | yes | 3 | +7 days |
| 3 | yes | 4 | +14 days |
| 4 | yes | 5 | +30 days |
| 5 | yes | 5 | +30 days |
| 1-5 | no | 1 | +1 day |

**Errors:**
- 400 (vocab not in session, already rated, invalid body)
- 401 (unauthorized)
- 403 (vocab not owned)
- 404 (session expired, vocab missing)

---

#### POST /vocabulary/review/:sessionId/complete
Complete a review session. Returns stats.

**Auth:** Required | **Response (201):**
```json
{
  "code": 1,
  "message": "Review completed",
  "data": {
    "total": 5,
    "correct": 4,
    "wrong": 1,
    "accuracy": 80,
    "box_distribution": [
      { "box": 1, "count": 0 },
      { "box": 2, "count": 2 },
      { "box": 3, "count": 1 },
      { "box": 4, "count": 1 },
      { "box": 5, "count": 1 }
    ]
  }
}
```

**Behavior:**
- Session is deleted after completion
- boxDistribution shows final box counts of all reviewed cards
- Deleted session cannot be resumed

**Errors:** 401 (unauthorized), 404 (session not found)

---

### Onboarding (No Auth Required)

#### POST /onboarding/chat
Start new session or continue existing onboarding conversation.

**Auth:** Not required | **Rate Limit:** 5 req/hr (new session), 30 req/hr (chat continuation)

**Create New Session — Request:**
```json
{
  "native_language": "english",
  "target_language": "spanish"
}
```

**Create New Session — Response (200):**
```json
{
  "code": 1,
  "message": "Session started",
  "data": {
    "conversation_id": "uuid",
    "reply": "Welcome! I'm excited to help you learn...",
    "message_id": "uuid",
    "turn_number": 1,
    "is_last_turn": false
  }
}
```

**Continue Existing Session — Request:**
```json
{
  "conversation_id": "uuid",
  "message": "I want to focus on speaking skills"
}
```

**Continue Existing Session — Response (200):**
```json
{
  "code": 1,
  "message": "Response generated",
  "data": {
    "conversation_id": "uuid",
    "reply": "Great choice! Speaking is crucial...",
    "message_id": "uuid",
    "turn_number": 2,
    "is_last_turn": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| native_language | string | Yes (new) | User's native language (required for new session only) |
| target_language | string | Yes (new) | Language user wants to learn (required for new session only) |
| conversation_id | UUID | Yes (resume) | Existing session ID (required to continue) |
| message | string | No (resume) | User's response (omit to skip turn) |

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| conversation_id | UUID | Unique session identifier |
| reply | string | AI tutor's response (greeting on turn 1) |
| message_id | UUID | ID of AI's message |
| turn_number | number | Current turn (1-based) |
| is_last_turn | boolean | True when max 10 turns reached |

**Behavior:**
- First request: omit `conversation_id`, include `native_language` and `target_language` → AI initiates with greeting
- Subsequent requests: include `conversation_id` and `message` → AI responds to user input
- Rate limits: 5/hr for session creation (new `conversation_id`), 30/hr for chat turns
- Sessions expire after 7 days of inactivity
- Maximum 10 turns per session

**Errors:**
- 400 (missing required fields, invalid languages)
- 429 (rate limit exceeded — 5/hr new sessions or 30/hr chat turns)
- 404 (session not found or expired)
- 503 (AI provider unavailable)

---

#### GET /onboarding/conversations/:conversationId/messages

**Auth:** public. **Throttler:** 30/hr per IP.

Fetch full transcript for an anonymous onboarding conversation. Used by mobile to rehydrate chat UI on resume.

**Path param:** `conversationId` (UUID v4).

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "turn_number": 3,
    "max_turns": 10,
    "is_last_turn": false,
    "messages": [
      {"id": "...", "role": "assistant", "content": "Hello!", "created_at": "2026-04-14T23:20:00Z"},
      {"id": "...", "role": "user", "content": "I want to learn English", "created_at": "2026-04-14T23:21:00Z"}
    ]
  }
}
```

**Errors:**
- 404 — conversation not found or not an anonymous onboarding session

---

#### POST /onboarding/complete
Complete onboarding and extract profile.

**Auth:** Not required | **Idempotent.** Second+ calls with same `conversation_id` return cached profile + scenarios (same scenario UUIDs) without re-invoking the LLM. Cache is populated on the first successful call (structured profile + 5 scenarios); partial failures skip caching and retry next call. | **Request:**
```json
{
  "conversation_id": "conversation_uuid"
}
```

**Response (200):** `{code: 1, message: "Onboarding completed", data: {extracted_profile: {languages, interests, level}}}`

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

**cURL - Get Profile:**
```bash
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**cURL - AI Chat:**
```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","context":{"conversation_id":"<uuid>","target_language":"Spanish","native_language":"English","proficiency_level":"beginner"}}'
```

**cURL - Scenario Chat (first turn):**
```bash
curl -X POST http://localhost:3000/scenario/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"550e8400-e29b-41d4-a716-446655440000"}'
```

**cURL - Scenario Chat (subsequent turn):**
```bash
curl -X POST http://localhost:3000/scenario/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"550e8400-e29b-41d4-a716-446655440000","message":"I need a table for two","conversation_id":"660e8400-e29b-41d4-a716-446655440000"}'
```

**cURL - Scenario Chat (re-practice / force new):**
```bash
curl -X POST http://localhost:3000/scenario/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"550e8400-e29b-41d4-a716-446655440000","force_new":true}'
```

**cURL - List past scenario conversations:**
```bash
curl http://localhost:3000/scenario/550e8400-e29b-41d4-a716-446655440000/conversations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**cURL - Fetch a scenario conversation transcript:**
```bash
curl http://localhost:3000/scenario/conversations/660e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Interactive Documentation

**Swagger UI:** Available at `/api/docs` in development mode
- Interactive API testing
- Request/response examples
- Schema definitions
- Authentication testing

Access: `http://localhost:3000/api/docs`

## Troubleshooting

**401 Unauthorized:**
- Verify JWT token is valid and not expired
- Check Authorization header format: `Bearer <token>`
- Ensure token from login/signup endpoint

**400 Bad Request:**
- Verify request body matches schema
- Check all required fields present
- Validate data types and formats

**503 Service Unavailable:**
- AI providers may be temporarily down
- Check API keys in environment variables
- Review Langfuse logs for provider errors

## Support

For API issues:
- Check Swagger documentation at `/api/docs`
- Review error messages and status codes
- Check application logs
- Contact development team via GitHub Issues
