# API Documentation

**Last Updated:** 2026-04-07
**Base URL:** `http://localhost:3000` (development)
**API Version:** 1.6.0

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
Register new user account.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response (201):** `{code: 1, message: "User registered", data: {access_token, user: {id, email, name}}}`

**Errors:** 400 (invalid input), 409 (email exists)

---

#### POST /auth/login
Login with email and password.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):** `{code: 1, message: "Logged in", data: {access_token, user: {...}}}`

**Errors:** 401 (invalid credentials)

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
Request password reset via OTP.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):** `{code: 1, message: "OTP sent to email", data: null}`

---

#### POST /auth/verify-otp
Verify OTP code.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response (200):** `{code: 1, message: "OTP verified", data: {reset_token}}`

**Errors:** 400 (invalid/expired OTP), 429 (too many attempts)

---

#### POST /auth/reset-password
Reset password with reset token.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "reset_token": "token_from_verify_otp",
  "new_password": "NewPassword123!"
}
```

**Response (200):** `{code: 1, message: "Password reset", data: null}`

**Errors:** 400 (invalid token/password)

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
