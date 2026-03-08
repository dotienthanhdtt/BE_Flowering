# Correction API

Base path: `/ai`
Auth: Bearer JWT OR anonymous (no auth required). Rate-limited via ThrottlerGuard.

---

## POST /ai/chat/correct

Check grammar/vocabulary of user's chat reply in context of previous AI message. Returns corrected text if errors found, null if correct. Designed to be called in parallel with chat response.

**Request Body**

```json
{
  "previousAiMessage": "How was your weekend?",
  "userMessage": "I go to park yesterday",
  "targetLanguage": "en"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `previousAiMessage` | string | yes | AI tutor's previous message for context (max 4000 chars) |
| `userMessage` | string | yes | User's reply to check for errors (max 4000 chars) |
| `targetLanguage` | string | yes | Target language code, e.g. `"en"`, `"ja"`, `"vi"` (max 10 chars) |

### Response 200 — Errors Found

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "correctedText": "I went to the park yesterday."
  }
}
```

### Response 200 — No Errors

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "correctedText": null
  }
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `correctedText` | string | yes | Corrected version of user's reply, or null if no errors |

**Behavior:** Stateless correction — no conversation history stored. Uses GPT-4.1 Nano (temperature 0.3) for fast, deterministic corrections. Only fixes clear grammar/vocabulary errors; does not over-correct casual speech.

**Errors**
- `400` — Missing or empty required fields
- `429` — Rate limit exceeded

**curl (anonymous)**
```bash
curl -X POST https://api.example.com/ai/chat/correct \
  -H "Content-Type: application/json" \
  -d '{"previousAiMessage":"How was your weekend?","userMessage":"I go to park yesterday","targetLanguage":"en"}'
```

**curl (authenticated)**
```bash
curl -X POST https://api.example.com/ai/chat/correct \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"previousAiMessage":"How was your weekend?","userMessage":"I go to park yesterday","targetLanguage":"en"}'
```
