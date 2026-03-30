# Translation API

Base path: `/ai`
Auth: Bearer JWT OR conversationId in body for anonymous onboarding users. Rate-limited via ThrottlerGuard.

---

## POST /ai/translate

Translate a word or sentence. Two modes via `type` field:
- `word` — translates a free-text word, saves to user vocabulary (upsert)
- `sentence` — translates an existing AI conversation message by ID, caches result

**Request Body**

```json
{
  "type": "word",
  "text": "hello",
  "sourceLang": "en",
  "targetLang": "vi"
}
```

```json
{
  "type": "sentence",
  "messageId": "uuid-of-ai-conversation-message",
  "sourceLang": "en",
  "targetLang": "vi"
}
```

**Anonymous word translate example (no JWT):**
```json
{
  "type": "word",
  "text": "hello",
  "sourceLang": "en",
  "targetLang": "vi",
  "conversationId": "abc123"
}
```

**Anonymous sentence translate example (no JWT):**
```json
{
  "type": "sentence",
  "messageId": "uuid-of-ai-conversation-message",
  "sourceLang": "en",
  "targetLang": "vi",
  "conversationId": "abc123"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | enum | yes | `"word"` or `"sentence"` |
| `text` | string | if type=word | Word to translate (max 255 chars) |
| `messageId` | UUID | if type=sentence | AI conversation message ID to translate |
| `sourceLang` | string | yes | Source language code (e.g., `"en"`) max 10 chars |
| `targetLang` | string | yes | Target language code (e.g., `"vi"`) max 10 chars |
| `conversationId` | string | if no JWT | Conversation ID for anonymous onboarding users (required when no Authorization header) |

### Word Response 200

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "original": "hello",
    "translation": "xin chào",
    "partOfSpeech": "interjection",
    "pronunciation": "hə.ˈloʊ",
    "definition": "a greeting used when meeting someone",
    "examples": ["Hello, how are you?", "She said hello to everyone."],
    "vocabularyId": "uuid"
  }
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `original` | string | no | Original word |
| `translation` | string | no | Translated word |
| `partOfSpeech` | string | yes | Part of speech (noun, verb, etc.) |
| `pronunciation` | string | yes | IPA pronunciation |
| `definition` | string | yes | Brief definition in source language |
| `examples` | string[] | yes | 2 example sentences in source language |
| `vocabularyId` | UUID | yes | Saved/updated vocabulary entry ID (undefined for anonymous users) |

**Behavior (Authenticated):** Upserts vocabulary — if the same user+word+sourceLang+targetLang exists, updates translation/partOfSpeech/pronunciation/definition/examples.

**Behavior (Anonymous):** Returns translation only without saving to vocabulary. `vocabularyId` is undefined.

### Sentence Response 200

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "messageId": "uuid",
    "original": "How are you today?",
    "translation": "Hôm nay bạn khỏe không?"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `messageId` | UUID | The translated message ID |
| `original` | string | Original message content |
| `translation` | string | Translated content |

**Behavior (Authenticated):** Caches translation on the message entity. Subsequent requests for the same message+targetLang return the cached result without calling the LLM.

**Behavior (Anonymous):** Returns translation only. Ownership verified via conversationId matching conversation.id.

**Errors**
- `400` — Validation error (missing `text` for word, missing `messageId` for sentence, or missing both JWT and conversationId)
- `403` — Message belongs to another user's conversation (authenticated mode) or conversationId does not match conversation (anonymous mode)
- `404` — Message not found (sentence mode)

**curl (word)**
```bash
curl -X POST https://api.example.com/ai/translate \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"type":"word","text":"hello","sourceLang":"en","targetLang":"vi"}'
```

**curl (sentence)**
```bash
curl -X POST https://api.example.com/ai/translate \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"type":"sentence","messageId":"550e8400-e29b-41d4-a716-446655440000","sourceLang":"en","targetLang":"vi"}'
```

**curl (anonymous word, no JWT)**
```bash
curl -X POST https://api.example.com/ai/translate \
  -H "Content-Type: application/json" \
  -d '{"type":"word","text":"hello","sourceLang":"en","targetLang":"vi","conversationId":"abc123"}'
```

**curl (anonymous sentence, no JWT)**
```bash
curl -X POST https://api.example.com/ai/translate \
  -H "Content-Type: application/json" \
  -d '{"type":"sentence","messageId":"550e8400-e29b-41d4-a716-446655440000","sourceLang":"en","targetLang":"vi","conversationId":"abc123"}'
```
