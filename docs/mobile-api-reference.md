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

### POST /auth/register
```json
// Request
{ "email": "user@example.com", "password": "Pass123!", "name": "John" }

// Response data
{ "access_token": "jwt", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

### POST /auth/login
```json
// Request
{ "email": "user@example.com", "password": "Pass123!" }

// Response data
{ "access_token": "jwt", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

### POST /auth/google
```json
// Request
{ "id_token": "google_id_token", "display_name": "John", "conversation_id": "optional" }

// Response data
{ "access_token": "jwt", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

### POST /auth/apple
```json
// Request
{ "identity_token": "apple_token", "user": { "email": "...", "name": "..." } }

// Response data
{ "access_token": "jwt", "user": { "id": "uuid", "email": "...", "name": "..." } }
```

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

### POST /auth/forgot-password
```json
// Request
{ "email": "user@example.com" }

// Response data: null
```

### POST /auth/verify-otp
```json
// Request
{ "email": "user@example.com", "otp": "123456" }

// Response data
{ "reset_token": "token" }
```

### POST /auth/reset-password
```json
// Request
{ "email": "user@example.com", "reset_token": "...", "new_password": "NewPass123!" }

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

### POST /subscriptions/sync *(auth required)*
Call after purchase and on app open. Empty body.
```json
// Response data: same shape as GET /subscriptions/me
```

---

## Notifications

### POST /notifications/devices *(auth required)*
```json
// Request
{ "token": "fcm_token", "platform": "ios|android|web", "device_name": "iPhone 15" }

// Response data: null
```

### DELETE /notifications/devices/:token *(auth required)*
```json
// Response data: null
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

### POST /ai/exercises/generate *(premium)*
```json
// Request
{ "language": "spanish", "level": "beginner", "type": "vocabulary|grammar|conversation" }

// Response data
[{ "type": "...", "prompt": "...", "expected_answer": "...", "difficulty": "..." }]
```

### POST /ai/conversations *(premium)*
```json
// Request
{ "language": "spanish", "topic": "daily_life" }

// Response data
{ "conversation_id": "uuid" }
```

### GET /ai/conversations/:id/messages *(premium)*
```json
// Response data
[
  {
    "role": "user|assistant",
    "content": "...",
    "model": "gpt-4o",
    "tokens_used": 123,
    "created_at": "2026-03-28T00:00:00Z"
  }
]
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
