# API Documentation

**Last Updated:** 2026-04-12
**Base URL:** `http://localhost:3000` (development)
**API Version:** 1.7.0

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

**All JSON keys (request body params and response data fields) use `snake_case`.**

```json
// Request
{ "target_language": "vi", "proficiency_level": "beginner" }

// Response data
{ "user_id": "abc", "access_token": "...", "created_at": "2026-03-28T..." }
```

The wrapper keys `code`, `message`, `data` are single-word and unchanged.

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

**Response (200):** `{code: 1, message: "Authenticated", data: {access_token, user: {...}}}`

**Behavior:**
- Accepts Firebase ID token from either Google or Apple sign-in
- Auto-detects provider based on token claims
- Auto-links to existing email or creates new account
- Stores provider-specific ID (googleProviderId or appleProviderId)
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

**Auth:** Required | **Response (200):** `{code: 1, message: "Logged out", data: null}`

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

**Auth:** Required | **Response (200):** `{code: 1, message: "User found", data: {id, email, name, profile_picture, email_verified, created_at, updated_at}}`

---

#### PATCH /users/me
Update user profile.

**Auth:** Required | **Request:**
```json
{
  "name": "Jane Doe",
  "profile_picture": "https://example.com/avatar.jpg"
}
```

**Response (200):** `{code: 1, message: "Profile updated", data: {...}}`

---

### Subscriptions

#### GET /subscriptions/me
Get subscription status.

**Auth:** Required | **Response (200):** `{code: 1, message: "Subscription found", data: {id, plan, status, is_active, current_period_start, current_period_end, cancel_at_period_end}}`

**Plan types:** free, monthly, yearly, lifetime
**Status types:** active, trial, expired, cancelled

---

#### POST /webhooks/revenuecat
RevenueCat webhook endpoint (idempotency via WebhookEvent table).

**Auth:** Bearer token (REVENUECAT_WEBHOOK_SECRET) | **Request:**
```json
{
  "event": {
    "type": "INITIAL_PURCHASE|RENEWAL|CANCELLATION|EXPIRATION|PRODUCT_CHANGE",
    "app_user_id": "user_uuid",
    "product_id": "monthly_subscription",
    "purchased_at_ms": 1706976000000,
    "expiration_at_ms": 1709654400000
  }
}
```

**Response (200):** `{code: 1, message: "Webhook received", data: {status: "received"}}`

**Processing:** Async (responds <60s)

---

### Languages

#### GET /languages
List available languages (public).

**Auth:** Not required | **Query params:** type=native|learning

**Response (200):** `{code: 1, message: "Languages found", data: [{id, code, name, native_name, flag_url, is_active}]}`

---

#### GET /languages/user
Get user's learning languages.

**Auth:** Required | **Response (200):** `{code: 1, message: "User languages found", data: [...]}`

---

#### POST /languages/user
Add language to learning list.

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
        "icon": "icon_url or null",
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

**Auth:** Required (Premium) | **Rate Limit:** 20 req/min, 100 req/hr | **Request:**
```json
{
  "message": "How do I use the past tense in Spanish?",
  "conversation_id": "uuid",
  "language": "spanish",
  "level": "beginner",
  "model": "gpt-4o"
}
```

**Response (200):** `{code: 1, message: "Response generated", data: {conversation_id, response, ai_provider, tokens_used}}`

---

#### SSE /ai/chat/stream
Stream chat response (Server-Sent Events).

**Auth:** Required | **Request:** Same as POST /ai/chat

**Response:** Streaming text chunks

---

#### POST /ai/chat/correct
Check grammar/vocabulary of user's chat reply in context of previous AI message.

**Auth:** Public (optional premium) | **Request:**
```json
{
  "previous_ai_message": "How was your weekend?",
  "user_message": "I go to park yesterday",
  "target_language": "en"
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| previous_ai_message | string | Yes | 4000 chars | AI tutor's previous message (context) |
| user_message | string | Yes | 4000 chars | User's reply to check |
| target_language | string | Yes | 10 chars | Target language code (e.g., "en", "ja", "vi") |

**Response (200) — errors found:** `{code: 1, message: "Success", data: {corrected_text: "I went to the park yesterday."}}`

**Response (200) — no errors:** `{code: 1, message: "Success", data: {corrected_text: null}}`

**Errors:** 400 (missing/empty fields), 429 (rate limit)

---

#### POST /ai/translate
Translate words or sentences with vocabulary persistence for words.

**Auth:** Public (optional premium) | **Request:**
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
| type | enum | Yes | - | WORD or SENTENCE |
| text | string | No | 255 chars | Word/phrase to translate (WORD only) |
| message_id | UUID | No | - | Conversation message ID (SENTENCE only) |
| source_lang | string | Yes | 10 chars | Source language code (e.g., "en", "ja") |
| target_lang | string | Yes | 10 chars | Target language code (e.g., "es", "vi") |
| conversation_id | string | No | - | Optional conversation ID for anonymous users |

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
| conversation_id | UUID | No | - | Optional onboarding conversation ID for context |

**cURL Example:**
```bash
curl -X POST http://localhost:3000/ai/transcribe \
  -H "Authorization: Bearer <jwt_token>" \
  -F "audio=@/path/to/audio.m4a" \
  -F "conversation_id=optional-uuid"
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
  "conversation_id": "uuid"
}
```

| Field | Type | Required | Limit | Description |
|-------|------|----------|-------|-------------|
| scenario_id | UUID | Yes | - | ID of scenario to engage with |
| message | string | No | 2000 chars | User's roleplay response (omit on first turn to let AI open) |
| conversation_id | UUID | No | - | Conversation ID to resume existing session |

**Response (200):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "reply": "Of course! A table for two right away. This way, please.",
    "conversation_id": "uuid",
    "turn": 1,
    "max_turns": 10,
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
- Premium subscription required

**Errors:**
- 400 (conversation completed, invalid body, scenario not found)
- 401 (missing/invalid JWT)
- 403 (free user trying premium scenario)
- 404 (scenario not found)

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

**Response (200):**
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
- Anonymous cards have sourceLang/targetLang, not language_id

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

**Response (200):**
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

**Auth:** Required | **Response (200):**
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

#### POST /onboarding/start
Start anonymous onboarding session.

**Auth:** Not required | **Request:**
```json
{
  "native_language": "english"
}
```

**Response (200):** `{code: 1, message: "Session started", data: {conversation_id, expires_at}}`

---

#### POST /onboarding/chat
Chat in onboarding session.

**Auth:** Not required | **Request:**
```json
{
  "conversation_id": "conversation_id",
  "message": "I want to learn Spanish"
}
```

**Response (200):** `{code: 1, message: "Response generated", data: {response, turn_count, max_turns}}`

---

#### POST /onboarding/complete
Complete onboarding and extract profile.

**Auth:** Not required | **Request:**
```json
{
  "conversation_id": "conversation_id"
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

**cURL - Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
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
  -d '{"message":"Hello!","language":"spanish"}'
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
