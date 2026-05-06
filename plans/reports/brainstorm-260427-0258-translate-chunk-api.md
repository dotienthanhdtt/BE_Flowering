# Brainstorm: Chunk-Aware Translation API

**Date:** 2026-04-27
**Status:** Approved, ready for `/ck:plan`
**Feature:** New `POST /ai/translate/word` endpoint that translates context-aware chunks (idioms, phrasal verbs, compound nouns, particles) given a sentence + tap range.

---

## Problem

Current `POST /ai/translate` with `type=word` translates a single word in isolation. Fails for:
- English idioms ("kick the bucket")
- Phrasal verbs ("look up", "give in")
- Compound nouns (zh `科技公司`, de `Krankenhaus`)
- Verb+aux chains (ja `勉強しています`)
- Particles/case markers (ja `は`, ko `이/가`)

User taps a character/word; client knows the full sentence + tap indices. Backend must resolve the smallest meaning-bearing chunk that contains the tap and translate *in context*.

## Constraints

- Reuse `prompts/translate_word.md` (already authored, char-indexed, multilingual).
- Use `gemini-3.1-flash-lite-preview` (already wired in `LLMModel` enum).
- Persist resolved chunks into existing `vocabulary` table for SRS.
- No breakage of existing `POST /ai/translate`.

## Approaches Considered

| # | Approach | Verdict |
|---|---|---|
| A | New endpoint `POST /ai/translate/word` (chunk-aware DTO) | **Chosen.** Clean separation, no DTO clutter. |
| B | Extend existing DTO with `type=chunk` | Rejected. Conditional fields balloon DTO. |
| C | Replace `type=word` path | Rejected. Clients still depend on it. |

| # | Vocab schema | Verdict |
|---|---|---|
| A | Add `type` column to `vocabulary` | **Chosen.** Enables filtering ("show my idioms"). |
| B | Reuse `part_of_speech` | Rejected. Semantically dirty. |
| C | Don't persist | Rejected. Loses learning value. |

## Final Design

### Endpoint
`POST /ai/translate/word`

### Request DTO (`translate-chunk-request.dto.ts`)
```ts
{
  messageId: string        // UUID — server resolves sentence from AI chat message
  sourceLang: string       // free text, max 10
  targetLang: string       // free text, max 10
  tapFrom: number          // inclusive char index, >= 0
  tapTo: number            // exclusive, > tapFrom, <= message.content.length
}
```

Source sentence is derived server-side from `message.content`. Ownership verified via existing `verifyMessageOwnership` (auth user OR anonymous-conversation match).

### Response
```ts
{
  text: string
  type: 'word'|'phrase'|'idiom'|'phrasal_verb'|'compound_noun'|'particle'|'article'|'fixed_expression'
  from: number
  to: number
  translation: string
  pronunciation?: string   // IPA / romaji / pinyin / etc, may be null for particles
  vocabularyId?: string    // present only for authed users
}
```

### Service Flow (`TranslationService.translateChunk`)
1. Load message by `messageId` (with `conversation` relation). 404 if not found.
2. `verifyMessageOwnership(message, userId, /* no conversationId */)` — only authed users for now (anon path requires conversationId which we removed; if anon support needed later, re-add).
3. Validate `tapTo <= message.content.length` and `tapFrom < tapTo`.
4. Load `prompts/translate_word.md` with `{sentence: message.content, source_lang, target_lang, tap_from, tap_to}`.
5. `UnifiedLLMService.chat()` with `LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW`, `temperature: 0`.
6. Parse JSON (reuse robust `parseWordResponse` pattern: try direct, fallback regex extract).
7. Upsert vocab on conflict `(user_id, word, source_lang, target_lang)`:
   - `word = chunk.text`
   - `translation = chunk.translation`
   - `type = chunk.type`
   - `pronunciation = chunk.pronunciation`
   - `orUpdate(['translation','type','pronunciation'], …)` — do NOT clobber `definition`/`examples`/`partOfSpeech` populated by old endpoint.

### Prompt Update
Append to `translate_word.md` OUTPUT JSON:
```json
{
  "text": "...",
  "type": "...",
  "from": 0,
  "to": 0,
  "translation": "...",
  "pronunciation": "<IPA | romaji | pinyin | revised romanization | null>"
}
```
Pronunciation rules per source lang:
- en/de/es → IPA
- ja → romaji
- ko → revised romanization
- zh → pinyin with tones
- particles/articles → may be null

Update inline example to include pronunciation field.

### DB Migration
File: `src/database/migrations/<ts>-add-type-to-vocabulary.ts`
```sql
-- up
ALTER TABLE vocabulary ADD COLUMN type VARCHAR(30) NULL;
-- down
ALTER TABLE vocabulary DROP COLUMN type;
```

### Entity Update (`vocabulary.entity.ts`)
```ts
@Column({ type: 'varchar', length: 30, nullable: true })
type?: string;
```
(`pronunciation` column already exists.)

### Controller (`ai.controller.ts`)
```ts
@Post('translate/word')
@ApiOperation({ summary: 'Translate a context-aware chunk in a sentence' })
async translateChunk(
  @CurrentUser() user: User,
  @Body() dto: TranslateChunkRequestDto,
) {
  return this.translationService.translateChunk(
    dto.messageId, dto.sourceLang, dto.targetLang,
    dto.tapFrom, dto.tapTo, user.id,
  );
}
```
Apply existing AI rate-limit decorator (20/min, 100/hr).

### Langfuse
Add `TRANSLATE_CHUNK = 'translate-chunk'` to `langfuse-feature.enum.ts`.

## Files Touched

**New**
- `src/modules/ai/dto/translate-chunk-request.dto.ts`
- `src/database/migrations/<ts>-add-type-to-vocabulary.ts`

**Modified**
- `src/modules/ai/dto/index.ts` (export DTO)
- `src/modules/ai/services/translation.service.ts` (+ `translateChunk`)
- `src/modules/ai/services/translation.service.spec.ts` (+ tests)
- `src/modules/ai/ai.controller.ts` (+ route)
- `src/modules/ai/langfuse-feature.enum.ts` (+ feature)
- `src/modules/ai/prompts/translate_word.md` (+ pronunciation field)
- `src/database/entities/vocabulary.entity.ts` (+ type column)
- `src/database/database.module.ts` (verify Vocabulary already registered — yes)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Gemini wraps JSON in code fences | Existing `parseWordResponse` regex-extracts `{...}` |
| LLM returns `from/to` outside sentence bounds | Log warn, clamp to `[tapFrom, tapTo]` |
| Chunk text > 255 chars | Truncate before vocab insert (rare for idioms) |
| Upsert clobbers richer fields from old endpoint | `orUpdate` whitelist: only `translation`, `type`, `pronunciation` |
| Index drift JS UTF-16 vs char | Acceptable for target langs (no astral plane usage) |
| Cost — no cache | v1 ships uncached; sentences typically unique per session |

## Success Criteria

- `POST /ai/translate/word` returns valid JSON matching schema for en, ja, ko, zh, de, es.
- Authed call creates vocab row with `type` and `pronunciation` populated.
- Unauth request (no JWT) → 401 (route is JWT-protected by global guard, no `@Public()`).
- 404 when `messageId` doesn't exist; 403 when caller doesn't own the message's conversation.
- 400 when `tapTo > message.content.length` or `tapFrom >= tapTo`.
- Idiom test: tapping inside "kick the bucket" returns full idiom (not "kick").
- Compound noun test (zh `我在一家科技公司工作`, tap_from=4, tap_to=5) returns `科技公司`.
- Existing `POST /ai/translate` behavior unchanged (regression check).
- Unit tests in `translation.service.spec.ts` cover authed/anon/malformed-JSON paths.

## Next Steps

1. Run `/ck:plan` against this report to generate phased implementation plan.
2. Generate migration (`npm run migration:generate`).
3. Implement service + controller + DTO + prompt update.
4. `npm run build` + `npm test` + manual curl verification.
5. Update `docs/api-documentation.md` with new endpoint.
