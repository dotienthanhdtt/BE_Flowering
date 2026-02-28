# Onboarding API

Base path: `/onboarding`
Auth: All endpoints are **public** (no JWT required). Sessions are identified by `sessionToken`.

---

## Flow Overview

```
POST /onboarding/start
  → returns sessionToken

POST /onboarding/chat  (repeat up to 10 turns)
  → send user message, receive AI reply

POST /onboarding/complete
  → extract structured profile from conversation

POST /auth/register|login|google|apple  (with sessionToken)
  → link onboarding session to user account
```

---

## POST /onboarding/start

Create a new anonymous onboarding chat session.

**Request Body**
```json
{
  "nativeLanguage": "vi",
  "targetLanguage": "en"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `nativeLanguage` | string | yes | ISO 639-1 native language code (2-5 chars) |
| `targetLanguage` | string | yes | ISO 639-1 target language code (2-5 chars) |

**Response 201**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "sessionToken": "550e8400-e29b-41d4-a716-446655440000",
    "conversationId": "uuid"
  }
}
```

| Field | Description |
|---|---|
| `sessionToken` | UUID to use in subsequent chat/complete calls. Valid for 7 days. |
| `conversationId` | Internal conversation ID |

**curl**
```bash
curl -X POST https://api.example.com/onboarding/start \
  -H "Content-Type: application/json" \
  -d '{"nativeLanguage":"vi","targetLanguage":"en"}'
```

---

## POST /onboarding/chat

Send a user message and receive an AI response. Up to 10 turns per session.

**Request Body**
```json
{
  "sessionToken": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Hi! My name is Thanh"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionToken` | UUID | yes | Session token from `/onboarding/start` |
| `message` | string | yes | User message (max 2000 chars) |

**Response 200**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "reply": "Nice to meet you, Thanh! What's your current English level?",
    "turnNumber": 1,
    "isLastTurn": false
  }
}
```

| Field | Description |
|---|---|
| `reply` | AI tutor response |
| `turnNumber` | Current turn (1–10) |
| `isLastTurn` | `true` when `turnNumber` equals max turns (10). AI will wrap up conversation. |

**Errors**
- `400` — Max turns reached (call `/onboarding/complete`) or session expired (7-day TTL)
- `404` — Session not found

**curl**
```bash
curl -X POST https://api.example.com/onboarding/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionToken":"550e8400-e29b-41d4-a716-446655440000","message":"Hi! My name is Thanh"}'
```

---

## POST /onboarding/complete

Extract a structured user profile from the onboarding conversation. Call after chat turns are done.

**Request Body**
```json
{
  "sessionToken": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionToken` | UUID | yes | Session token from `/onboarding/start` |

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
  -d '{"sessionToken":"550e8400-e29b-41d4-a716-446655440000"}'
```

---

## Session Lifecycle

| State | Description |
|---|---|
| `ANONYMOUS` | Active session not yet linked to a user account |
| `AUTHENTICATED` | Linked after user registers/logs in with `sessionToken` |

- Session TTL: **7 days**
- Max turns: **10** (5 exchanges)
- AI model: Gemini 2.0 Flash
- Linking is best-effort; authentication succeeds even if linking fails
