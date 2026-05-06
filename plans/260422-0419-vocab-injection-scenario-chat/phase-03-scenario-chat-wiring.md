# Phase 03 — Scenario-Chat Wiring

## Context Links

- Brainstorm: `plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md` (§4.2, §4.3)
- Phase 02 output (`VocabularyInjectionService`)
- Target files:
  - `src/modules/scenario/services/scenario-chat.service.ts` (lines 88–108 prompt build)
  - `src/modules/scenario/scenario-chat.module.ts`
  - `src/modules/ai/prompts/scenario-chat-prompt.json`
- Language source: `langCtx.targetLanguage` is the **display name** (`active.language.name`, e.g. "English"). For DB filter we need the **code** (`active.language.code`, e.g. "en"). Must surface the code — see step 2.

## Overview

- **Priority:** P1 (blocks Phase 04)
- **Status:** done
- **Brief:** Integrate `VocabularyInjectionService` into `ScenarioChatService.chat()`. Turn-1 selects + persists IDs on conversation row. Turn 2+ hydrates from stored IDs. Prompt receives new `userVocabulary` variable with soft-hint instructions.

## Key Insights

- Current service detects turn-1 via `history.length === 0` (already computed as `isOpening`). Reuse that — no new flag needed.
- `loadLanguageContext()` returns `targetLanguage` (name). To filter `Vocabulary.target_lang` (code), extend the method to also return `targetLangCode` from `active.language.code`.
- Turn-1 selection wrapped in `try/catch` — failure falls back to empty array (brainstorm decision 9). Log warning but never throw.
- `injectedVocabIds` persisted in step 11 alongside existing `conversation.save()` — no extra DB round-trip.
- Prompt variable `userVocabulary` is a **string** (PromptLoader only does string substitution). Serialize array as a readable list, e.g. `"- hello (xin chào) [box 2]\n- thanks (cảm ơn) [box 1]"`. Empty array → omit the section entirely (render empty string for the substitution so the prompt reads cleanly).
- Prompt is JSON; adding structured block means the JSON must remain valid. Use a single string value for the vocab hint block keyed as `learner.active_vocabulary`.

## Requirements

### Functional
- Turn-1 (first user message AND no cached IDs): call `selectVocabularyForConversation`, persist IDs (may be empty array `[]`, not NULL) to `conversation.injectedVocabIds`.
- Turn 2+ OR if `injectedVocabIds` is non-null: skip selection, call `hydrateByIds(cachedIds)`.
- Handle `injectedVocabIds === null` on turn >1 edge case (existing conversation created pre-feature): treat as empty array, do not re-compute (avoids retroactive injection mid-conversation; consistency wins per brainstorm §4.2).
- Pass `userVocabulary` variable to prompt. Format: bullet list with `word (translation) [box N]` per line, or empty string if no words.
- Selection failure → log warning, proceed with empty array, do NOT block user.

### Non-Functional
- Turn-1 adds ≤ 50ms latency (two indexed `LIMIT 5` queries + save).
- Turn 2+ adds ≤ 10ms (one `WHERE id = ANY` + format).
- No new round-trip on turn 2+ beyond hydration.
- File size: `scenario-chat.service.ts` currently 315 lines — keep growth under +40 lines by extracting vocab-handling into a private method `resolveInjectedVocabulary`.

## Architecture

### Data Flow

```
chat(userId, dto, languageId):
  ...existing steps 0-6...
  6b. const injectedVocab = await this.resolveInjectedVocabulary(conversation, langCtx.targetLangCode)
       ├─ turn-1 branch: select + persist (may be [])
       └─ turn-n branch: hydrate cached ids (may be [])
  7. promptLoader.loadPrompt('scenario-chat-prompt.json', {
       ...existing vars,
       userVocabulary: formatVocabList(injectedVocab),  // "" if empty
     })
  ...existing steps 8-11 (save conv already persisted ids earlier, still fine)...
```

### Selection cache state machine

| Current `injectedVocabIds` | Turn | Action |
|----------------------------|------|--------|
| NULL | 1 (isOpening) | Compute → persist (set `[]` if bucket empty) → use |
| NULL | 2+ | Treat as empty `[]`, do NOT re-compute |
| `[]` (empty array) | any | Hydrate returns `[]` → inject empty |
| `[uuid,...]` | any | Hydrate → inject |

## Related Code Files

### Create
- none (service + config done in Phase 02)

### Modify
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/scenario-chat.module.ts`
- `src/modules/ai/prompts/scenario-chat-prompt.json`

### Delete
- none

## Implementation Steps

1. **Update prompt JSON** `src/modules/ai/prompts/scenario-chat-prompt.json`:
   - Add key inside `learner` object:
     ```json
     "active_vocabulary": "{{userVocabulary}}"
     ```
   - Add a new rule entry to `rules` array:
     ```json
     "If the learner has active vocabulary listed below, weave one or two words naturally into your reply where it fits the scenario. Do NOT force usage if it feels awkward. Do NOT announce the words."
     ```
   - Keep JSON valid (trailing comma hazard). Verify by `JSON.parse` via Node/ts-node.

2. **Extend** `loadLanguageContext()` in `scenario-chat.service.ts`:
   - Return shape becomes `{ targetLanguage, targetLangCode, nativeLanguage, proficiencyLevel }`.
   - `targetLangCode = active.language.code`.
   - Update caller (single site, line 85).

3. **Update module** `src/modules/scenario/scenario-chat.module.ts`:
   - Import `Vocabulary`, `VocabularyInjectionEvent` (entity used in Phase 04, add now to avoid two touches).
   - Add both to `TypeOrmModule.forFeature([...])`.
   - Add `VocabularyInjectionService` to `providers`.

4. **Modify** `ScenarioChatService`:
   - Inject `VocabularyInjectionService` via constructor.
   - Add private method:
     ```ts
     private async resolveInjectedVocabulary(
       conversation: AiConversation,
       targetLangCode: string,
     ): Promise<Vocabulary[]> {
       // Cache hit (already computed for this conversation, even if empty array)
       if (conversation.injectedVocabIds !== null && conversation.injectedVocabIds !== undefined) {
         return this.vocabInjection.hydrateByIds(conversation.injectedVocabIds);
       }
       // First opportunity (turn 1 AND column is NULL) — compute + persist
       try {
         const picked = await this.vocabInjection.selectVocabularyForConversation(
           conversation.userId!,
           targetLangCode,
         );
         conversation.injectedVocabIds = picked.map(v => v.id);  // [] if none
         await this.convoRepo.save(conversation);
         return picked;
       } catch (err) {
         this.logger.warn(`Vocab injection failed for conv ${conversation.id}: ${(err as Error).message}`);
         conversation.injectedVocabIds = [];
         try { await this.convoRepo.save(conversation); } catch { /* swallow */ }
         return [];
       }
     }
     ```
   - Add `private readonly logger = new Logger(ScenarioChatService.name)` if not present.
   - Add private formatter:
     ```ts
     private formatVocabList(vocab: Vocabulary[]): string {
       if (!vocab.length) return '';
       return vocab.map(v => `- ${v.word} (${v.translation}) [box ${v.box}]`).join('\n');
     }
     ```
   - In `chat()` after step 6 / before step 7, call `resolveInjectedVocabulary`. Pass result into prompt build:
     ```ts
     const injectedVocab = await this.resolveInjectedVocabulary(conversation, langCtx.targetLangCode);
     const systemPrompt = this.promptLoader.loadPrompt('scenario-chat-prompt.json', {
       ...existingVars,
       userVocabulary: this.formatVocabList(injectedVocab),
     });
     ```
   - **Leave** `injectedVocab` accessible later in `chat()` scope — Phase 04 will reuse it for usage-tracking without re-hydrating.

5. **Build check**: `npm run build` — must compile. Fix any type issues (`injectedVocabIds` nullable handling).

6. **Smoke test** (local, manual):
   - Create a user with 3 vocab words in target lang.
   - POST `/scenario/chat` (turn 1) — DB verify `injected_vocab_ids` populated.
   - POST `/scenario/chat` (turn 2) — DB verify column unchanged, response still arrives.
   - POST `/scenario/chat` for scenario with 0 vocab user — verify `[]` stored and no error.

## Todo List

- [ ] Update `scenario-chat-prompt.json` (add variable + rule, JSON valid)
- [ ] Extend `loadLanguageContext` to return `targetLangCode`
- [ ] Register `Vocabulary` + `VocabularyInjectionEvent` in scenario-chat module's `forFeature`
- [ ] Register `VocabularyInjectionService` as provider
- [ ] Inject service into `ScenarioChatService` constructor
- [ ] Implement `resolveInjectedVocabulary` private method
- [ ] Implement `formatVocabList` private method
- [ ] Wire call into `chat()` + pass `userVocabulary` to prompt loader
- [ ] `npm run build` passes
- [ ] Manual smoke test turn-1/turn-2/empty vocab user

## Success Criteria

- `chat()` response shape unchanged (`ScenarioChatResponseDto` untouched).
- Turn-1 persists `injected_vocab_ids` (array, possibly empty).
- Turn-2+ does not call `selectVocabularyForConversation`.
- LLM prompt contains vocab list when user has words; empty line when user has none.
- Selection failure (e.g. DB disconnect mid-call) logs warning + returns response with no injected words.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Turn-1 double-save (once for vocab, once at step 11) increases race window | Low | Low | Both save the same `conversation` ref; second save overwrites first with compatible state — acceptable |
| Persisting `null` vs `[]` inconsistently breaks hydration branch | Med | Med | Explicit state-machine table above; assert `!== null && !== undefined` not truthy check (empty array is falsey in some paths) |
| Prompt JSON parse breakage from unescaped chars | Low | High | Unit test loads + `JSON.parse` the file; escape hardening in `formatVocabList` (replace `\n` with escaped `\\n` if inserted raw into JSON string) |
| `{{userVocabulary}}` contains newlines — breaks JSON parse after substitution | High | High | PromptLoader reads file as text, substitutes, then feeds LLM as plain string. JSON structure isn't re-parsed post-substitution — **safe**. Verify by tracing `PromptLoaderService.loadPrompt` in Phase 05 test |
| `langCtx.targetLangCode` undefined breaks vocab query | Low | High | Enforce non-null assertion + unit test for the case where active language has missing code |

## Security Considerations

- `conversation.userId!` — guarded by prior access checks (`scenarioAccessService.findAccessibleScenario` throws if not owner). Non-null assertion safe here because scenario chat is authenticated-only.
- No user input enters the vocab query path — only IDs from `UserLanguage` + user's own UUID.
- Logged warning does not include vocabulary content (only conversation id) → no PII/data leak in logs.

## Next Steps

- Phase 04 consumes `injectedVocab` already in scope to detect usage in user message.
- No migration or schema changes.
