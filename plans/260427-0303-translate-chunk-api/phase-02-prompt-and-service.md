# Phase 2 — Prompt Update + Service Method

## Context Links
- Brainstorm: `../reports/brainstorm-260427-0258-translate-chunk-api.md`
- Prompt: `src/modules/ai/prompts/translate_word.md`
- Service: `src/modules/ai/services/translation.service.ts`
- Langfuse enum: `src/modules/ai/langfuse-feature.enum.ts`

## Overview
- **Priority:** P2
- **Status:** complete
- **Effort:** ~1h
Extend the existing `translate_word.md` prompt to include `pronunciation`. Add `translateChunk()` method to `TranslationService` using `GEMINI_3_1_FLASH_LITE_PREVIEW`.

## Key Insights
- Don't create a new service — extend `TranslationService` (DRY).
- Reuse `parseWordResponse` JSON-extraction pattern; generalize to handle the new fields.
- Upsert MUST use `orUpdate(['translation','type','pronunciation'], ...)` only — preserves richer fields populated by old `/ai/translate` (definition, examples, partOfSpeech).
- Whitelist `type` against allowed enum values before insert; if LLM returns garbage, store `null`.

## Requirements
- Prompt returns valid JSON with `pronunciation` field per source-lang rules (IPA / romaji / pinyin / revised romanization / null)
- Service method signature: `translateChunk(messageId, sourceLang, targetLang, tapFrom, tapTo, userId): Promise<ChunkTranslationResult>`
- Validates `tapTo <= message.content.length` and `tapFrom < tapTo` after loading message
- Verifies ownership via existing `verifyMessageOwnership(message, userId)` (no conversationId path)
- Clamps out-of-bounds `from/to` returned by LLM to `[tapFrom, tapTo]` and logs warn
- Truncates chunk text to 255 chars before vocab insert

## Architecture
```
Controller → translateChunk()
  ├── messageRepo.findOne({id, relations:['conversation']})  → 404
  ├── verifyMessageOwnership(msg, userId)                    → 403
  ├── validate tap range                                     → 400
  ├── promptLoader.loadPrompt('translate_word.md', {...})
  ├── unifiedLLM.chat(GEMINI_3_1_FLASH_LITE_PREVIEW, temp=0)
  ├── parseChunkResponse(raw)
  ├── whitelist type, clamp from/to, truncate text
  └── vocabularyRepo upsert (orUpdate whitelist)
       → returns {text, type, from, to, translation, pronunciation, vocabularyId}
```

## Related Code Files
**Modify:**
- `src/modules/ai/prompts/translate_word.md` — add `pronunciation` to OUTPUT schema + example, document per-lang rules
- `src/modules/ai/services/translation.service.ts` — add `ChunkTranslationResult` interface, `translateChunk` method, `parseChunkResponse` helper
- `src/modules/ai/langfuse-feature.enum.ts` — add `TRANSLATE_CHUNK = 'translate-chunk'`

## Implementation Steps

### 1. Prompt update
Edit `prompts/translate_word.md`:
- In `# OUTPUT` JSON, add `"pronunciation": "<IPA | romaji | pinyin | revised romanization | null>"`.
- Add `# PRONUNCIATION` section before OUTPUT:
  ```
  - en/de/es: IPA, e.g. /kɪk ðə ˈbʌkɪt/
  - ja: romaji, e.g. "benkyou shite imasu"
  - ko: revised romanization, e.g. "gongbuhago isseoyo"
  - zh: pinyin with tones, e.g. "kējì gōngsī"
  - particles/articles or unpronounceable chunks: null
  ```
- Update example output to include `"pronunciation": "kējì gōngsī"`.

### 2. Langfuse feature enum
```ts
export enum LangfuseFeature {
  // ...existing
  TRANSLATE_CHUNK = 'translate-chunk',
}
```

### 3. Service additions

**Interface (above class):**
```ts
export interface ChunkTranslationResult {
  text: string;
  type: string;
  from: number;
  to: number;
  translation: string;
  pronunciation?: string;
  vocabularyId?: string;
}

const ALLOWED_CHUNK_TYPES = new Set([
  'word','phrase','idiom','phrasal_verb','compound_noun',
  'particle','article','fixed_expression',
]);
```

**Method:**
```ts
async translateChunk(
  messageId: string,
  sourceLang: string,
  targetLang: string,
  tapFrom: number,
  tapTo: number,
  userId: string,
): Promise<ChunkTranslationResult> {
  if (tapFrom < 0 || tapTo <= tapFrom) {
    throw new BadRequestException('Invalid tap range');
  }

  const message = await this.messageRepo.findOne({
    where: { id: messageId },
    relations: ['conversation'],
  });
  if (!message) throw new NotFoundException('Message not found');
  this.verifyMessageOwnership(message, userId);

  if (tapTo > message.content.length) {
    throw new BadRequestException('tapTo exceeds message length');
  }

  const prompt = this.promptLoader.loadPrompt('translate_word.md', {
    sentence: message.content,
    source_lang: sourceLang,
    target_lang: targetLang,
    tap_from: String(tapFrom),
    tap_to: String(tapTo),
  });

  const response = await this.llmService.chat([new HumanMessage(prompt)], {
    model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
    temperature: 0,
    metadata: {
      feature: LangfuseFeature.TRANSLATE_CHUNK,
      userId, messageId,
      conversationId: message.conversationId,
      sourceLang, targetLang,
    },
  });

  const parsed = this.parseChunkResponse(response, message.content, tapFrom, tapTo);

  const chunkText = parsed.text.slice(0, 255);
  const result = await this.vocabularyRepo
    .createQueryBuilder()
    .insert()
    .into(Vocabulary)
    .values({
      userId,
      word: chunkText,
      translation: parsed.translation,
      sourceLang,
      targetLang,
      type: parsed.type,
      pronunciation: parsed.pronunciation,
    })
    .orUpdate(
      ['translation', 'type', 'pronunciation'],
      ['user_id', 'word', 'source_lang', 'target_lang'],
    )
    .returning('id')
    .execute();

  return {
    ...parsed,
    text: chunkText,
    vocabularyId: result.generatedMaps[0]?.id ?? result.raw[0]?.id,
  };
}
```

**Parser:**
```ts
private parseChunkResponse(
  raw: string, sentence: string, tapFrom: number, tapTo: number,
): Omit<ChunkTranslationResult, 'vocabularyId'> {
  let obj: Record<string, unknown> = {};
  try { obj = JSON.parse(raw.trim()); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { /* fall through */ } }
  }

  const text = String(obj.text ?? sentence.slice(tapFrom, tapTo));
  const typeRaw = String(obj.type ?? 'word');
  const type = ALLOWED_CHUNK_TYPES.has(typeRaw) ? typeRaw : 'word';
  let from = Number.isInteger(obj.from) ? (obj.from as number) : tapFrom;
  let to = Number.isInteger(obj.to) ? (obj.to as number) : tapTo;
  if (from < 0 || to > sentence.length || from >= to) {
    this.logger.warn(`LLM returned invalid range [${from},${to}], clamping`);
    from = tapFrom; to = tapTo;
  }
  const translation = String(obj.translation ?? '');
  const pronunciation = obj.pronunciation == null
    ? undefined
    : String(obj.pronunciation);

  return { text, type, from, to, translation, pronunciation };
}
```

### 4. `verifyMessageOwnership` signature
Existing method already accepts optional `conversationId`. Calling without it works — auth-only path returns success when `userId === message.conversation.userId`. No change needed.

## Todo List
- [x] Update `translate_word.md` (pronunciation field + example + section)
- [x] Add `TRANSLATE_CHUNK` to `LangfuseFeature`
- [x] Add `ChunkTranslationResult` interface and `ALLOWED_CHUNK_TYPES` set
- [x] Implement `translateChunk()` method
- [x] Implement `parseChunkResponse()` helper
- [x] `npm run build` clean

## Success Criteria
- Build passes
- Manual prompt test (paste prompt into LLM playground) returns valid JSON with pronunciation
- Type whitelist rejects garbage (defaults to `'word'`)
- Out-of-bounds `from/to` clamped without throwing

## Risk Assessment
- **Risk:** Gemini returns code-fenced JSON despite instruction. **Mitigation:** regex extract `{...}` (existing pattern).
- **Risk:** Prompt token bloat. **Mitigation:** prompt is small (~1KB); negligible cost on flash-lite.
- **Risk:** `verifyMessageOwnership` throws `ForbiddenException` for valid auth users on anon conversations. **Mitigation:** anon conversations are owned `userId=null`; authed user calling chunk API on anon msg → forbidden, which is correct.

## Security Considerations
- Type field whitelisted before insert — prevents storing arbitrary LLM-controlled strings.
- Chunk text capped at 255 to match column length and prevent abuse.
- Ownership check before any LLM call (avoid free LLM calls on others' messages).

## Next Steps
- Phase 3 wires the controller route.
