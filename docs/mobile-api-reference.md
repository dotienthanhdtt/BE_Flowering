# Mobile API Reference

**Base URL:** `http://localhost:3000` (dev) | production URL via env
**All JSON keys use `snake_case`**
**Auth header:** `Authorization: Bearer <access_token>`
**Content-Type:** `application/json`

---

## Response Wrapper

All responses follow this format:

```json
{ "code": 1, "message": "...", "data": { ... } }
{ "code": 0, "message": "error description", "data": null }
```

---

## Auth

### POST /auth/register — DISABLED (410 Gone)
Email/password authentication is no longer supported. Use Firebase sign-in instead.

### POST /auth/login — DISABLED (410 Gone)
Email/password authentication is no longer supported. Use Firebase sign-in instead.

### POST /auth/firebase — UNIFIED OAuth
Accepts Firebase ID token from either Google or Apple. Backend auto-detects provider.

```json
// Request
{ "id_token": "firebase_id_token" }

// Response data
{
  "access_token": "jwt_token",
  "refresh_token": "uuid:hex",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "profile_picture": "url"
  }
}
```

**Provider Detection:**
- Google ID tokens: `aud` claim matches Google client ID
- Apple ID tokens: `iss` claim contains `appleid.apple.com`

### POST /auth/refresh
```json
// Request
{ "refresh_token": "uuid:hex" }

// Response data
{ "access_token": "jwt", "refresh_token": "uuid:hex" }
```

### POST /auth/logout *(auth required)*
```json
// Response data: null
```

---

## User

### GET /users/me *(auth required)*
```json
// Response data
{
  "id": "uuid",
  "email": "...",
  "name": "...",
  "profile_picture": "url",
  "email_verified": true,
  "created_at": "2026-03-28T00:00:00Z",
  "updated_at": "2026-03-28T00:00:00Z"
}
```

### PATCH /users/me *(auth required)*
```json
// Request
{ "name": "Jane", "profile_picture": "https://..." }

// Response data: updated user object (same shape as GET /users/me)
```

---

## Languages

### GET /languages — public
Query: `?type=native|learning`
```json
// Response data
[
  {
    "id": "uuid",
    "code": "vi",
    "name": "Vietnamese",
    "native_name": "Tiếng Việt",
    "flag_url": "url",
    "is_active": true
  }
]
```

### GET /languages/user *(auth required)*
```json
// Response data: array of user language objects
```

### POST /languages/user *(auth required)*
```json
// Request
{ "language_id": "uuid", "proficiency_level": "beginner|intermediate|advanced|native" }
```

### PATCH /languages/user/:language_id *(auth required)*
```json
// Request
{ "proficiency_level": "intermediate" }
```

### PATCH /languages/user/native *(auth required)*
```json
// Request
{ "language_id": "uuid" }
```

### DELETE /languages/user/:language_id *(auth required)*
```json
// Response data: null
```

---

## Subscriptions

### GET /subscriptions/me *(auth required)*
```json
// Response data
{
  "id": "uuid",
  "plan": "free|monthly|yearly|lifetime",
  "status": "active|trial|expired|cancelled",
  "is_active": true,
  "current_period_start": "2026-03-01T00:00:00Z",
  "current_period_end": "2026-04-01T00:00:00Z",
  "cancel_at_period_end": false
}
```

---

## Lessons

### GET /lessons *(auth required)*
Query: `?language=<language_uuid>&level=beginner|intermediate|advanced&search=<term>&page=1&limit=10`
```json
// Response data
{
  "total": 45,
  "page": 1,
  "limit": 10,
  "categories": [
    {
      "id": "uuid",
      "name": "Greetings",
      "icon": "url",
      "scenarios": [
        {
          "id": "uuid",
          "title": "Meet & Greet",
          "difficulty": "beginner",
          "status": "available|locked|learned",
          "access_tier": "free|premium"
        }
      ]
    }
  ]
}
```

**Status Values:**
- `available` — accessible to user (free scenario or premium with active subscription)
- `locked` — premium scenario but user lacks active subscription
- `learned` — user has completed scenario

---

## Scenarios

### POST /scenario/chat *(premium)*
Turn-based roleplay conversation. Language context via header `X-Learning-Language: <code>`.

**First turn** (omit message to get AI greeting):
```json
// Request
{ "scenario_id": "uuid" }
// Header: X-Learning-Language: es

// Response data
{
  "conversation_id": "uuid",
  "turn_number": 1,
  "max_turns": 12,
  "message": "Hola! Bienvenido al café. Qué deseas?",
  "completed": false
}
```

**Continue turn**:
```json
// Request
{ "conversation_id": "uuid", "scenario_id": "uuid", "message": "Quisiera un café, por favor" }
// Header: X-Learning-Language: es

// Response data
{
  "conversation_id": "uuid",
  "turn_number": 2,
  "max_turns": 12,
  "message": "Excelente! Un café para ti. Algo más?",
  "completed": false
}
```

### GET /scenarios/:id *(auth required)*
Scenario detail with access state (soft-lock, no 403).
```json
// Response data
{
  "id": "uuid",
  "title": "Café Conversation",
  "description": "...",
  "access_tier": "premium",
  "is_locked": true,
  "lock_reason": "premium_required"
}
```

### GET /scenario/conversations/:conversation_id *(auth required)*
Fetch conversation transcript.
```json
// Response data
{
  "id": "uuid",
  "scenario_id": "uuid",
  "turn_number": 5,
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "ai", "text": "..." }
  ]
}
```

---

## Vocabulary *(auth required)*

### GET /vocabulary
Query: `?language=<language_code>&box=1-5&search=<term>&page=1&limit=20`
```json
// Response data
{
  "total": 150,
  "page": 1,
  "limit": 20,
  "items": [
    {
      "id": "uuid",
      "word": "beautiful",
      "translation": "hermoso",
      "source_lang": "en",
      "target_lang": "es",
      "pronunciation": "er-MO-so",
      "box": 1,
      "due_at": "2026-04-21T00:00:00Z",
      "review_count": 5,
      "correct_count": 4
    }
  ]
}
```

### GET /vocabulary/:id
```json
// Response data: single vocabulary item (same shape as GET /vocabulary item)
```

### DELETE /vocabulary/:id
```json
// Response: null
```

### POST /vocabulary/review/start *(auth required)*
Language context via header `X-Learning-Language: <code>`.
```json
// Request: (empty body)
// Header: X-Learning-Language: es

// Response data
{
  "session_id": "uuid",
  "cards": [
    { "id": "vocab-uuid", "word": "hermoso", "translation": "beautiful" }
  ]
}
```

### POST /vocabulary/review/:sessionId/rate *(auth required)*
```json
// Request
{ "vocab_id": "uuid", "correct": true }

// Response data
{
  "session_id": "uuid",
  "next_card": { "id": "vocab-uuid", "word": "..." }
}
```

### POST /vocabulary/review/:sessionId/complete *(auth required)*
```json
// Request: (empty body)

// Response data
{
  "accuracy": 0.85,
  "total_cards": 20,
  "correct": 17,
  "box_distribution": { "1": 10, "2": 5, "3": 3, "4": 2, "5": 0 }
}
```

---

## AI

> Rate limit: 20 req/min, 100 req/hr per user. Premium required unless noted.

### POST /ai/chat *(premium)*
```json
// Request
{
  "message": "How do I use past tense in Spanish?",
  "conversation_id": "uuid",
  "language": "spanish",
  "level": "beginner",
  "model": "gpt-4o"
}

// Response data
{
  "conversation_id": "uuid",
  "response": "...",
  "ai_provider": "openai",
  "tokens_used": 123
}
```

### POST /ai/chat/correct — public (optional auth)
```json
// Request
{
  "previous_ai_message": "How was your weekend?",
  "user_message": "I go to park yesterday",
  "target_language": "en"
}

// Response data — errors found
{ "corrected_text": "I went to the park yesterday." }

// Response data — no errors
{ "corrected_text": null }
```

### POST /ai/translate — public (optional auth)
```json
// Word translation
{ "type": "WORD", "text": "beautiful", "source_lang": "en", "target_lang": "es" }
// Response data
{ "translation": "hermoso", "word": "beautiful", "pronunciation": "er-MO-so" }

// Sentence translation
{ "type": "SENTENCE", "message_id": "uuid", "source_lang": "en", "target_lang": "es", "conversation_id": "optional" }
// Response data
{ "translated_content": "Eso es hermoso." }
```

---

## Onboarding — no auth required

### POST /onboarding/chat

Single endpoint. Omit `conversation_id` on first call to create a session; the response always includes the `conversation_id`.

**Create (first call)** — 5 req/hour/IP
```json
// Request
{ "native_language": "vi", "target_language": "en" }

// Response data
{
  "conversation_id": "uuid",
  "reply": "Hi! What's your current level?",
  "message_id": "uuid",
  "turn_number": 1,
  "is_last_turn": false
}
```

**Continue** — 30 req/hour/IP
```json
// Request
{ "conversation_id": "uuid", "message": "I want to learn Spanish" }

// Response data
{
  "conversation_id": "uuid",
  "reply": "...",
  "message_id": "uuid",
  "turn_number": 2,
  "is_last_turn": false
}
```

### POST /onboarding/complete

**Idempotent.** First call extracts and caches profile + 5 scenarios. Subsequent calls return same data (with same scenario UUIDs) without re-invoking LLM.

```json
// Request
{ "conversation_id": "uuid" }

// Response data
{
  "extracted_profile": {
    "languages": ["spanish"],
    "interests": ["travel"],
    "level": "beginner"
  }
}
```

### GET /onboarding/conversations/:conversationId/messages

Fetch full transcript for an anonymous onboarding conversation (used by mobile on resume to rehydrate chat UI).

**Parameters:**
- `conversationId` (path, required) — UUID v4

**Throttling:** 30 req/hour/IP

```json
// Response data
{
  "conversation_id": "uuid",
  "turn_number": 3,
  "max_turns": 10,
  "is_last_turn": false,
  "messages": [
    {
      "id": "msg-uuid-1",
      "role": "assistant",
      "content": "Hi! What's your current level?",
      "created_at": "2026-04-15T10:00:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "user",
      "content": "I'm a beginner",
      "created_at": "2026-04-15T10:01:00Z"
    }
  ]
}
```

**Errors:**
- 404 — conversation not found or not an anonymous onboarding session

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400 | Invalid input / missing fields |
| 401 | Missing or expired token |
| 403 | Premium required |
| 404 | Resource not found |
| 409 | Conflict (e.g. email exists) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
