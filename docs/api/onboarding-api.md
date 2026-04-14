# Onboarding API

Base path: `/onboarding`
Auth: All endpoints are **public** (no JWT required). Sessions are identified by `conversationId`.

---

## Flow Overview

```
POST /onboarding/chat  (first call — omit conversationId)
  → creates anonymous session + returns conversationId + AI greeting (turn 1)

POST /onboarding/chat  (repeat with conversationId + message, up to max turns)
  → send user message, receive AI reply

POST /onboarding/complete
  → extract structured profile from conversation

POST /auth/register|login|google|apple  (with conversationId)
  → link onboarding session to user account
```

---

## POST /onboarding/chat

Single endpoint for both **session creation** and **chat turns**. Branch selected by presence of `conversationId`.

### Branch A — Create session (no `conversationId`)

Creates a new anonymous session and runs the first LLM turn (AI greeting). Rate limit: **5 requests / hour / IP**.

**Request Body**
```json
{
  "nativeLanguage": "vi",
  "targetLanguage": "en"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `nativeLanguage` | string | yes (when no `conversationId`) | ISO 639-1 native language (2–5 chars) |
| `targetLanguage` | string | yes (when no `conversationId`) | ISO 639-1 target language (2–5 chars) |
| `message` | string | ignored on creation | — |

### Branch B — Continue session (with `conversationId`)

Validates session, runs the next chat turn. Rate limit: **30 requests / hour / IP**.

**Request Body**
```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Hi! My name is Thanh"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | UUID | yes | Conversation ID returned by first call |
| `message` | string | optional | User message (max 2000 chars); empty/missing → AI continues |
| `nativeLanguage`, `targetLanguage` | — | ignored on continue | — |

### Response 200 (uniform for both branches)

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "reply": "Nice to meet you! What's your current English level?",
    "messageId": "msg-uuid",
    "turnNumber": 1,
    "isLastTurn": false
  }
}
```

| Field | Description |
|---|---|
| `conversationId` | Always returned. Store after first call; send back on subsequent calls. Valid 7 days. |
| `reply` | AI tutor response |
| `messageId` | UUID of the assistant message persisted to DB |
| `turnNumber` | Current turn (1-based) |
| `isLastTurn` | `true` when max turns reached — call `/onboarding/complete` next |

**Errors**
- `400` — Missing required fields, max turns reached, session expired (7-day TTL)
- `404` — Session not found (invalid `conversationId`)
- `429` — Rate limit exceeded (5/hr on creation branch, 30/hr on chat branch)

**curl (create)**
```bash
curl -X POST https://api.example.com/onboarding/chat \
  -H "Content-Type: application/json" \
  -d '{"nativeLanguage":"vi","targetLanguage":"en"}'
```

**curl (continue)**
```bash
curl -X POST https://api.example.com/onboarding/chat \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"550e8400-e29b-41d4-a716-446655440000","message":"Hi! My name is Thanh"}'
```

---

## POST /onboarding/complete

Extract a structured user profile from the onboarding conversation. Call after chat turns are done.

**Request Body**
```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | UUID | yes | Conversation ID obtained from the first `/onboarding/chat` response |

**Response 200**

Returns an extracted profile object plus 5 AI-generated scenario cards. Typical example:
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "name": "Thanh",
    "nativeLanguage": "vi",
    "targetLanguage": "en",
    "currentLevel": "B1",
    "learningGoals": ["business communication", "travel"],
    "weeklyAvailability": "5 hours",
    "preferredTopics": ["technology", "sports"],
    "scenarios": [
      {
        "id": "uuid-v4",
        "title": "Business Meeting Vocabulary",
        "description": "Practice professional phrases for meetings and presentations.",
        "icon": "briefcase",
        "accentColor": "primary"
      }
    ]
  }
}
```

**`scenarios[]` item fields:**
| Field | Type | Description |
|---|---|---|
| `id` | UUID | Server-generated scenario identifier |
| `title` | string | Short scenario title |
| `description` | string | 1-2 sentence description |
| `icon` | string | Lucide icon name |
| `accentColor` | `primary`\|`blue`\|`green`\|`lavender`\|`rose` | Card accent color token |

Scenarios are AI-generated from the learner profile. Returns **exactly 5** items, or `[]` if generation fails. Scenarios are not stored in the database.

If profile extraction fails, returns `{ "raw": "<ai response text>", "scenarios": [] }`.

**Errors**
- `404` — Session not found

**curl**
```bash
curl -X POST https://api.example.com/onboarding/complete \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"550e8400-e29b-41d4-a716-446655440000"}'
```

---

## Session Lifecycle

| State | Description |
|---|---|
| `ANONYMOUS` | Active session not yet linked to a user account |
| `AUTHENTICATED` | Linked after user registers/logs in with `conversationId` |

- Session TTL: **7 days**
- Max turns: configured in `onboarding.config.ts` (default 8)
- AI model: Gemini family (see `onboarding.config.ts`)
- Linking is best-effort; authentication succeeds even if linking fails

---

## Migration notes (2026-04-14)

`POST /onboarding/start` has been **removed**. Clients must call `POST /onboarding/chat` without `conversationId` on first invocation — that single call creates the session and returns both `conversationId` and the first AI greeting, eliminating a round-trip.
