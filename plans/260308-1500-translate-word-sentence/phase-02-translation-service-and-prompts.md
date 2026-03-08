# Phase 2: Translation Service & Prompts

## Context Links
- [Plan overview](plan.md)
- [Phase 1: Database](phase-01-database-migration-and-entities.md)
- UnifiedLLMService: `src/modules/ai/services/unified-llm.service.ts`
- PromptLoaderService: `src/modules/ai/services/prompt-loader.service.ts`
- Existing prompts: `src/modules/ai/prompts/*.md`

## Overview
- **Priority:** High
- **Status:** Complete
- **Description:** Create TranslationService and LLM prompt templates for word/sentence translation
- **Completed:** 2026-03-08

## Key Insights
- UnifiedLLMService.chat() takes BaseMessage[] + LLMOptions, returns string
- PromptLoaderService loads .md files with {{variable}} substitution
- Default model: Gemini 2.0 Flash (fast, cheap)
- Word response needs JSON parsing from LLM output
- Sentence response is plain text

## Requirements
- TranslationService with translateWord() and translateSentence() methods
- Word: call LLM → parse JSON → upsert vocabulary → return result
- Sentence: check cache → call LLM if needed → update message → return result
- Ownership validation: user must own the conversation for sentence translation
- Prompt templates following existing pattern

## Architecture
```
AiController.translate()
  └→ TranslationService
       ├→ translateWord(userId, text, sourceLang, targetLang)
       │   ├→ PromptLoaderService.loadPrompt('translate-word')
       │   ├→ UnifiedLLMService.chat()
       │   ├→ Parse JSON response
       │   └→ Upsert vocabulary row
       └→ translateSentence(userId, messageId, sourceLang, targetLang)
           ├→ Find message + verify ownership
           ├→ Check cached translation
           ├→ PromptLoaderService.loadPrompt('translate-sentence')
           ├→ UnifiedLLMService.chat()
           └→ Update message columns
```

## Related Code Files

**Create:**
- `src/modules/ai/services/translation.service.ts`
- `src/modules/ai/prompts/translate-word.md`
- `src/modules/ai/prompts/translate-sentence.md`

**Modify:**
- `src/modules/ai/ai.module.ts` — register TranslationService, Vocabulary entity

## Implementation Steps

1. Create `translate-word.md` prompt:
   ```
   Translate the word "{{word}}" from {{sourceLang}} to {{targetLang}}.
   Respond with ONLY a JSON object: {"translation": "...", "partOfSpeech": "...", "pronunciation": "..."}
   - translation: the translated word
   - partOfSpeech: noun, verb, adjective, adverb, etc.
   - pronunciation: phonetic transcription of the original word (IPA format)
   No explanations. No markdown. Only the JSON object.
   ```

2. Create `translate-sentence.md` prompt:
   ```
   Translate this sentence from {{sourceLang}} to {{targetLang}}:
   "{{sentence}}"
   Return ONLY the translated sentence. No explanations. No quotes.
   ```

3. Create `translation.service.ts`:
   - Inject: Repository<Vocabulary>, Repository<AiConversationMessage>, Repository<AiConversation>, UnifiedLLMService, PromptLoaderService
   - `translateWord(userId, text, sourceLang, targetLang)`:
     - Load prompt, call LLM, parse JSON response
     - Upsert vocabulary (queryBuilder INSERT ... ON CONFLICT DO UPDATE)
     - Return {original, translation, partOfSpeech, pronunciation, vocabularyId}
   - `translateSentence(userId, messageId, sourceLang, targetLang)`:
     - Find message with conversation relation
     - Verify conversation.userId === userId (throw ForbiddenException)
     - If message.translatedContent && message.translatedLang === targetLang → return cached
     - Load prompt, call LLM
     - Update message: translatedContent, translatedLang
     - Return {messageId, original, translation}

4. Update `ai.module.ts`:
   - Add Vocabulary to TypeOrmModule.forFeature
   - Add AiConversation to TypeOrmModule.forFeature (if not already)
   - Add TranslationService to providers

## Todo List
- [x] Create translate-word.md prompt
- [x] Create translate-sentence.md prompt
- [x] Create translation.service.ts
- [x] Register in ai.module.ts
- [x] Verify build: `npm run build`
- [x] Handle race condition on concurrent vocabulary upserts

## Success Criteria
- Service compiles and injects correctly
- Word translation returns parsed JSON with all fields
- Sentence translation caches result on message
- Ownership check prevents unauthorized access
- Graceful error handling for LLM parse failures

## Risk Assessment
- **LLM JSON parsing**: LLM may return malformed JSON → wrap in try/catch, use regex fallback to extract JSON
- **Upsert race condition**: Two concurrent requests for same word → ON CONFLICT handles gracefully
- **Message not found**: Return NotFoundException

## Security Considerations
- ForbiddenException if user doesn't own conversation
- Input sanitization via DTO validation (Phase 3)

## Next Steps
→ Phase 3: API endpoint + DTO
