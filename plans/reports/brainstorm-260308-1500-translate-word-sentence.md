# Brainstorm: Translate Word & Sentence Feature

## Problem Statement
Users need to translate words/sentences while chatting with AI tutor. Two translation types:
- **Word**: user selects a word → translate → save to vocabulary
- **Sentence**: user clicks translate on a message → translate entire message content

## Decisions Made

### 1. Vocabulary Scope: **User-scoped**
Each user builds their own vocabulary list. Words saved per user with translation pair.

### 2. Translation Provider: **LLM via UnifiedLLMService**
Use existing Gemini Flash infrastructure with a translation prompt. Context-aware, no extra API keys needed.

### 3. Sentence Translation Storage: **New columns on ai_conversation_messages**
Add `translated_content` (text, nullable) and `translated_lang` (varchar(10), nullable) columns. Avoids re-translating same message.

### 4. Word Detail Level: **Translation + basics**
Return: word, translation, part of speech, phonetic/pronunciation.

### 5. API Design: **Single endpoint**
`POST /ai/translate` with `type: 'word' | 'sentence'` discriminator.

### 6. Vocab Uniqueness: **Unique per user+word+pair**
`UNIQUE(user_id, word, source_lang, target_lang)` — prevents duplicates, allows same word across language pairs.

---

## Architecture

### New Entity: `vocabulary` table
```
id              uuid PK
user_id         uuid FK → users (CASCADE)
word            varchar(255)          -- original word
translation     varchar(255)          -- translated word
source_lang     varchar(10)           -- e.g. "en"
target_lang     varchar(10)           -- e.g. "vi"
part_of_speech  varchar(50) nullable  -- noun, verb, adj, etc.
pronunciation   varchar(255) nullable -- phonetic transcription
created_at      timestamptz

UNIQUE(user_id, word, source_lang, target_lang)
```

### Migration: alter ai_conversation_messages
```sql
ALTER TABLE ai_conversation_messages ADD COLUMN translated_content text;
ALTER TABLE ai_conversation_messages ADD COLUMN translated_lang varchar(10);
```

### API Contract

**POST /ai/translate** (JWT required)

Request (word):
```json
{
  "type": "word",
  "text": "hello",
  "sourceLang": "en",
  "targetLang": "vi"
}
```

Response (word):
```json
{
  "code": 1,
  "message": "Translation successful",
  "data": {
    "type": "word",
    "original": "hello",
    "translation": "xin chào",
    "sourceLang": "en",
    "targetLang": "vi",
    "partOfSpeech": "interjection",
    "pronunciation": "/həˈloʊ/",
    "vocabularyId": "uuid"
  }
}
```

Request (sentence):
```json
{
  "type": "sentence",
  "messageId": "uuid-of-ai-conversation-message",
  "sourceLang": "en",
  "targetLang": "vi"
}
```

Response (sentence):
```json
{
  "code": 1,
  "message": "Translation successful",
  "data": {
    "type": "sentence",
    "messageId": "uuid",
    "original": "How are you doing today?",
    "translation": "Hôm nay bạn khỏe không?",
    "sourceLang": "en",
    "targetLang": "vi"
  }
}
```

### LLM Prompt Strategy

**Word translation prompt:**
```
Translate the word "{word}" from {sourceLang} to {targetLang}.
Return JSON: {"translation": "...", "partOfSpeech": "...", "pronunciation": "..."}
Only the word. No explanations.
```

**Sentence translation prompt:**
```
Translate this sentence from {sourceLang} to {targetLang}:
"{sentence}"
Return only the translated sentence, nothing else.
```

### Flow

**Word flow:**
1. FE sends POST /ai/translate {type: "word", text, sourceLang, targetLang}
2. BE calls UnifiedLLMService with word translation prompt
3. Parse LLM JSON response
4. Upsert into vocabulary table (ON CONFLICT DO UPDATE translation)
5. Return translation + vocabulary ID

**Sentence flow:**
1. FE sends POST /ai/translate {type: "sentence", messageId, sourceLang, targetLang}
2. BE looks up message by ID, verify user owns the conversation
3. If `translated_content` exists and `translated_lang` matches → return cached
4. Call UnifiedLLMService with sentence translation prompt
5. Update message row: set translated_content, translated_lang
6. Return translation

### Files to Create/Modify

**Create:**
- `src/database/entities/vocabulary.entity.ts`
- `src/modules/ai/dto/translate.dto.ts`
- `src/modules/ai/services/translation.service.ts`
- `src/modules/ai/prompts/translate-word.md`
- `src/modules/ai/prompts/translate-sentence.md`
- Migration file for vocabulary table + message columns

**Modify:**
- `src/database/entities/ai-conversation-message.entity.ts` — add translated_content, translated_lang
- `src/database/entities/index.ts` — export Vocabulary
- `src/modules/ai/ai.module.ts` — register TranslationService, Vocabulary entity
- `src/modules/ai/ai.controller.ts` — add translate endpoint

---

## Risk Assessment
- **LLM response parsing**: JSON parsing from LLM can fail → wrap in try/catch, validate schema
- **Rate limiting**: Translation calls use LLM tokens → apply existing rate limits (20/min)
- **Authorization**: Sentence translation must verify user owns the conversation message
- **Caching**: Sentence translation cached on message; word translation upserted in vocab

## Success Criteria
- [ ] Single POST /ai/translate endpoint handles both word and sentence
- [ ] Word translations saved to user-scoped vocabulary table
- [ ] Sentence translations cached on ai_conversation_messages columns
- [ ] LLM-powered via existing UnifiedLLMService
- [ ] Proper auth + ownership checks
- [ ] No duplicate vocab entries per user+word+lang pair
