# Phase 04 — Usage Tracking & Touch-Review

## Context Links

- Brainstorm: `plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md` (§4.5, §7, §11 approved answers)
- Approved Q&A:
  - Naive lowercase substring match acceptable for MVP.
  - When word used in conversation → treat as review (update `lastReviewedAt` + `reviewCount`) but DO NOT advance box / increment `correctCount`.
  - Analytics insert fire-and-forget.
- Target files from Phase 03: `ScenarioChatService`, `VocabularyInjectionService` (stays read-only), `VocabularyReviewService` (needs new method).

## Overview

- **Priority:** P1 (completes feature value loop)
- **Status:** done
- **Brief:** After user message persists, scan it against `injectedVocab` word list. For each hit: (a) insert row in `vocabulary_injection_events` with `was_used=true`; (b) touch-review the vocab row. Misses also log one row per injected word with `was_used=false`. Async, non-blocking.

## Key Insights

- Word-boundary match via `\b` in JavaScript RegExp works for Latin scripts; for CJK (no spaces) it falls back to substring — ACCEPTED by user for MVP.
- Escape regex special chars in user-provided `word` strings before building regex (`[.*+?^${}()|[\]\\]` → escaped). Critical — malformed word could throw at runtime.
- Touch-review = minimal SRS write (no Leitner math). Reuse `VocabularyReviewService` by adding a new thin method `touchReviewed(vocabId, userId)`:
  ```ts
  async touchReviewed(userId: string, vocabId: string): Promise<void> {
    await this.repo.update({ id: vocabId, userId }, {
      lastReviewedAt: () => 'NOW()',
      reviewCount: () => '"review_count" + 1',
    });
  }
  ```
  - Uses `.update(criteria, partial)` with raw expression functions — TypeORM supports for date/increment.
- Fire-and-forget: wrap in `void (async () => { ... })().catch(err => logger.warn(...))`. Never `await`.
- Events insert batched in one INSERT when possible (single `.save([...rows])` call).
- One event per injected word per turn, not per hit. If word appears twice, still one row.
- The `injectedVocab` array from Phase 03 is reused as-is — no re-hydration.

## Requirements

### Functional
- Only trigger when user message non-empty (`dto.message` present).
- Only trigger when `injectedVocab.length > 0`.
- Detection rule: `was_used = true` if regex `/\b<escapedWord>\b/i` matches user message. For CJK-script words (no word-boundary support): fallback `message.toLowerCase().includes(word.toLowerCase())`.
- Heuristic for CJK detection: if `word` contains any char matching `/[぀-鿿가-힯]/` → use substring path; else word-boundary regex.
- Insert N rows into `vocabulary_injection_events` (one per injected word), each with `conversationId`, `turnIndex` (= currentTurn), `vocabularyId`, `was_used` boolean, `createdAt` default.
- For `was_used=true` rows only: call `VocabularyReviewService.touchReviewed(userId, vocabId)` per hit.
- All above happens after step 11 (conversation saved) AND before `return` — but async fire-and-forget, response already returnable.

### Non-Functional
- Response latency NOT affected by analytics writes (verify via timing in Phase 05 e2e).
- Failure in analytics path MUST NOT fail the chat response. Log warn only.
- `VocabularyReviewService.touchReviewed` file size guard — `vocabulary-review.service.ts` already 128 lines, adding ~10 lines stays under 200.

## Architecture

### Data Flow

```
chat(...):
  ...step 10 persist user+assistant messages...
  ...step 11 save conversation state...
  // NEW step 12 — fire and forget
  void this.trackUsage(conversation.id, conversation.userId, currentTurn, injectedVocab, dto.message)
    .catch(err => this.logger.warn(`Usage-track failed conv=${conversation.id}: ${err.message}`));
  return { reply, ... };

trackUsage(convId, userId, turnIndex, vocab[], userMsg?):
  if (!userMsg || !vocab.length) return;
  const hits: {vocabId, used}[] = vocab.map(v => ({ vocabId: v.id, used: matchesWord(userMsg, v.word) }));
  await this.eventsRepo.save(hits.map(h => ({ conversationId, vocabularyId: h.vocabId, turnIndex, wasUsed: h.used })));
  const usedIds = hits.filter(h => h.used).map(h => h.vocabId);
  await Promise.all(usedIds.map(id => this.vocabReview.touchReviewed(userId, id)));
```

### `matchesWord(text, word)` contract

| Input word script | Technique |
|-------------------|-----------|
| Latin + diacritics | `new RegExp(\`\\b${escape(word)}\\b\`, 'i').test(text)` |
| Contains CJK (`぀-鿿`) or Hangul (`가-힯`) | `text.toLowerCase().includes(word.toLowerCase())` |
| Empty/whitespace-only word | `false` (skip) |

## Related Code Files

### Create
- `src/modules/scenario/services/vocabulary-usage-matcher.ts` — pure function `matchesWord(text, word): boolean` + `escapeRegex` helper. Testable in isolation, <50 lines.
- `src/modules/scenario/services/vocabulary-usage-matcher.spec.ts`

### Modify
- `src/modules/scenario/services/scenario-chat.service.ts` — add `trackUsage` private method, invoke async
- `src/modules/scenario/scenario-chat.module.ts` — import `VocabularyModule` (to inject `VocabularyReviewService`); ensure `VocabularyInjectionEvent` repo registered (done in Phase 03)
- `src/modules/vocabulary/services/vocabulary-review.service.ts` — add `touchReviewed(userId, vocabId)` method
- `src/modules/vocabulary/vocabulary.module.ts` — add `VocabularyReviewService` to `exports` (currently only exports `VocabularyService`)

### Delete
- none

## Implementation Steps

1. **Add** `touchReviewed` to `VocabularyReviewService`:
   ```ts
   async touchReviewed(userId: string, vocabId: string): Promise<void> {
     await this.repo.update(
       { id: vocabId, userId },
       {
         lastReviewedAt: () => 'NOW()',
         reviewCount: () => '"review_count" + 1',
       },
     );
   }
   ```
   - Method does NOT check existence; missing row → UPDATE affects 0 rows silently. Acceptable for fire-and-forget path.

2. **Export** `VocabularyReviewService` from `vocabulary.module.ts`:
   ```ts
   exports: [VocabularyService, VocabularyReviewService],
   ```

3. **Create matcher** `src/modules/scenario/services/vocabulary-usage-matcher.ts`:
   ```ts
   const CJK_RANGE = /[぀-鿿가-힯]/;
   const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

   function escapeRegex(s: string): string {
     return s.replace(REGEX_ESCAPE, '\\$&');
   }

   export function matchesWord(text: string, word: string): boolean {
     const w = word.trim();
     if (!w || !text) return false;
     if (CJK_RANGE.test(w)) return text.toLowerCase().includes(w.toLowerCase());
     try {
       return new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(text);
     } catch { return false; }
   }
   ```

4. **Unit test** `vocabulary-usage-matcher.spec.ts`:
   - "hello" matches "Say hello, friend" (case-insensitive, word-boundary).
   - "hello" does NOT match "helloworld" (word-boundary guard).
   - "こんにちは" matches "今日こんにちは" (CJK substring).
   - Empty word → false.
   - Regex metachar word like "c++" does not throw, returns false or boundary-matched.
   - Accented word "café" matches "le café" (Latin path, case-insensitive).

5. **Modify** `ScenarioChatService`:
   - Import `VocabularyInjectionEvent` + `VocabularyReviewService`.
   - Add `@InjectRepository(VocabularyInjectionEvent) private readonly eventsRepo` + `private readonly vocabReview: VocabularyReviewService` to constructor.
   - Add private method:
     ```ts
     private async trackUsage(
       conversationId: string,
       userId: string,
       turnIndex: number,
       vocab: Vocabulary[],
       userMessage: string | undefined,
     ): Promise<void> {
       if (!userMessage || !vocab.length) return;
       const hits = vocab.map(v => ({ vocabId: v.id, used: matchesWord(userMessage, v.word) }));
       const rows = hits.map(h => this.eventsRepo.create({
         conversationId,
         vocabularyId: h.vocabId,
         turnIndex,
         wasUsed: h.used,
       }));
       await this.eventsRepo.save(rows);
       const usedIds = hits.filter(h => h.used).map(h => h.vocabId);
       await Promise.all(usedIds.map(id => this.vocabReview.touchReviewed(userId, id)));
     }
     ```
   - Call from `chat()` after conversation save, **before** `return`:
     ```ts
     void this.trackUsage(conversation.id, userId, currentTurn, injectedVocab, dto.message)
       .catch(err => this.logger.warn(`Usage-track failed conv=${conversation.id}: ${(err as Error).message}`));
     ```

6. **Update module** `scenario-chat.module.ts`:
   - Add `VocabularyModule` to `imports` so `VocabularyReviewService` DI resolves.

7. **Build + lint**: `npm run build && npm run lint`.

## Todo List

- [ ] Add `touchReviewed(userId, vocabId)` to `VocabularyReviewService`
- [ ] Export `VocabularyReviewService` from `VocabularyModule`
- [ ] Create `vocabulary-usage-matcher.ts` pure function
- [ ] Unit-test matcher (6 cases above)
- [ ] Inject events repo + `VocabularyReviewService` into `ScenarioChatService`
- [ ] Implement `trackUsage` private method
- [ ] Wire fire-and-forget call at end of `chat()`
- [ ] Import `VocabularyModule` in scenario-chat module
- [ ] `npm run build` passes
- [ ] Smoke test: send user message containing an injected word → verify events row + `reviewCount` increment + `box` unchanged

## Success Criteria

- For each injected word: exactly 1 row in `vocabulary_injection_events` per turn.
- For each hit: `vocabulary.last_reviewed_at` updated to NOW, `review_count` incremented by 1, `box` and `correct_count` unchanged.
- Analytics path failure does NOT alter chat response (verified by killing events-repo save in test — response still returns).
- Matcher correctly handles Latin + CJK fixtures in unit tests.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `review_count` race condition under concurrent turns | Low | Low | Used-word updates inside fire-and-forget; atomic `UPDATE ... SET review_count = review_count + 1` is race-safe |
| Analytics writes saturate DB on busy users | Low | Med | Max 10 rows/turn; batched single INSERT; negligible load |
| Regex metachar in user vocab `word` throws | Med | Med | `escapeRegex` before `new RegExp`; wrapped in `try/catch` returning false |
| `touchReviewed` silently no-ops if user deleted vocab mid-chat | Low | Low | Acceptable — vocab removed is vocab not reviewed; no error bubble |
| CJK `.toLowerCase()` affects nothing (no case) but wasted CPU | Low | Low | Negligible |
| Fire-and-forget error swallowed too quietly | Low | Med | `.catch(...)` logs warn — monitor via Langfuse/Logging later |

## Security Considerations

- User message scanned only against that user's own vocab list → no cross-tenant probing.
- Regex built from user-owned `word` field, but still escaped — defense in depth.
- Touch-review scoped by `{ id: vocabId, userId }` — cannot affect another user's rows even with a forged ID.
- Events table contains vocabulary IDs only — no message content stored (avoid PII accumulation).

## Next Steps

- Phase 05 exercises the full path end-to-end.
- Future (out of scope): aggregate `vocabulary_injection_events` for SRS signal (e.g. if same word used 3× → bump box). Do NOT build now.
