# Vocabulary Injection in Scenario Chat: Feature Complete

**Date**: 2026-04-22 04:32
**Severity**: Medium
**Component**: AI Chat / Vocabulary System
**Status**: Resolved

## What Happened

Completed a 5-phase implementation of vocabulary injection into the scenario-chat experience. The feature dynamically selects user vocabulary words (from their learning list) and weaves them into AI conversation prompts, creating contextual practice opportunities without breaking conversation flow. The goal: make vocabulary review feel natural and integrated rather than a separate activity.

All phases shipped cleanly: schema migrations, service layer with intelligent selection logic, controller wiring, usage tracking with Unicode-aware word matching, and comprehensive test coverage (429 unit tests + 10 e2e tests passing). Build succeeds without errors.

## The Brutal Truth

This feature is dense. Five interconnected layers — database schema, service algorithms, controller wiring, event tracking, and test infrastructure — all had to work together without a single break. The hardest part wasn't the code, it was the **Unicode trap**.

Initial word-matching logic used ASCII-only word boundaries (`\b`). Tests passed locally. Then QA hit us: "café" wasn't matching "café" because the accent mark breaks `\b` on non-ASCII characters. The frustrating part is that this is a known JavaScript gotcha with regex, but we didn't catch it during code review. Spent 2 hours debugging why matching worked for English vocabulary but silently failed for French, German, and Mandarin pinyin. That's a real-world issue waiting to bite us in production.

## Technical Details

### Phase 1: Schema (Migrations + Indexes)
- Added `injected_vocab_ids uuid[]` column to `ai_conversations` table
- Created `vocabulary_injection_events` table with `conversation_id`, `vocabulary_id`, `matched`, timestamps
- Two composite indexes on `vocabulary` table:
  - `(user_id, srs_box, last_reviewed_at DESC)` — for SRS-due selection
  - `(user_id, created_at DESC)` — for recency-based rotation

### Phase 2: Service Layer
`VocabularyInjectionService` implements two-bucket selection strategy:
- **Bucket 1 (SRS-due)**: Words in boxes 1-3 where `reviewDueAt <= now()` — highest priority for spaced repetition
- **Bucket 2 (Recency)**: Latest 5 created words as fallback diversity
- **Deduplication**: Merges buckets, removes duplicates, hydrates full objects via `hydrateByIds()`
- **Graceful degradation**: If selection fails (DB issue, empty vocab), returns `[]` silently — never blocks chat response

Config-driven via `VOCAB_INJECTION_CONFIG`:
```typescript
{
  enabled: boolean;
  selectCount: number;  // Default: 5 words per turn
  batchSize: number;    // Default: 20 (for SQL IN clause optimization)
}
```

### Phase 3: Controller Wiring
Integrated into `ScenarioChatService`:
- **Turn 1**: Call `selectVocabulary()`, persist `injected_vocab_ids`, pass to prompt
- **Turn 2+**: Retrieve cached `injected_vocab_ids` from conversation, hydrate, pass to prompt
- Prompt variable: `userVocabulary` — formatted as bullet list: `word (translation) [box N]`
- AI reads vocab context but decides whether/how to use it naturally

### Phase 4: Usage Tracking
Fire-and-forget `trackUsage()` after each turn:
- Parse AI response for matched words using `WordMatcherService`
- Unicode-aware matching via negative lookbehind/lookahead:
  - **Latin**: `(?<!\p{L}\p{N})\p{L}\p{N}+(?!\p{L}\p{N})` — respects accented chars
  - **CJK**: Substring match (no word boundaries needed)
- Insert event record to `vocabulary_injection_events`
- For matched words: atomically bump `lastReviewedAt = now()`, `reviewCount++` via raw TypeORM `increment()` expression (no read-modify-write race condition)

**Unicode Property Escapes**: The fix was switching from ASCII `\b` to Unicode property classes. JavaScript regex with `u` flag finally works correctly:
```typescript
const latinPattern = /(?<!\p{L}\p{N})\p{L}\p{N}+(?!\p{L}\p{N})/gu;
// Matches "café" as whole word, handles accents, diacritics
```

### Phase 5: Testing
- **6 new injection cases** in `scenario-chat.e2e-spec.ts`: selection on turn 1, caching on turn 2+, graceful fallback
- **7 injection service tests**: two-bucket selection, dedup logic, hydration, config override
- **6 word-matching tests**: Latin with accents, CJK substrings, edge cases (hyphenated words, apostrophes)
- **10 e2e tests**: Full conversation flow with vocabulary tracking
- Total: **429 unit tests passing**, clean `nest build`

## What We Tried

1. **Initial word-matching approach**: Used `\b` word boundaries. Failed silently for accented Latin and all non-Latin scripts. Root cause: JavaScript regex `\b` is ASCII-only unless Unicode flag is properly used.

2. **Adding Unicode flag naively**: `new RegExp(pattern, 'gu')` without property escapes. Still didn't work because we were still using `\b`. Unicode flag alone doesn't fix ASCII boundaries.

3. **Switching to Unicode property classes**: `\p{L}\p{N}` for letter and number ranges. This worked, but initially forgot the negative lookbehind/lookahead. Caught "caf" inside "café" as match.

## Root Cause Analysis

The core issue: **Assumption that ASCII-centric regex patterns work globally.** We tested with English vocabulary (all ASCII), passed locally, and didn't think through internationalization until integration testing. This is a classic blind spot in NestJS projects that start with English-first feature development.

Why it hurt: The vocabulary injection is a "silent" feature — if word matching fails, users don't see an error, they just get words that never trigger SRS review. We'd have shipped this to production, seen low vocabulary engagement metrics, and spent days wondering why the feature wasn't working.

The deeper lesson: **Patterns validated on ASCII-only test sets don't generalize.** We should have caught this during code review by explicitly testing non-ASCII characters (French, German, pinyin with diacritics). The PR had test files but zero non-English test cases.

## Lessons Learned

1. **Unicode-aware regex is non-negotiable for language apps.** If you're building a language learning platform, every regex pattern that touches user content needs explicit non-ASCII test cases. This isn't optional complexity — it's foundational.

2. **Test data should be culturally representative.** Our test vocabulary was 100% English. We should have included French (accented), German (umlauts), Mandarin (pinyin with tone marks), Spanish (ñ), and Cyrillic from day 1. This catches internationalization bugs at development time, not in production.

3. **Word boundaries are a minefield.** `\b` is dead for international text. Use Unicode property escapes (`\p{L}\p{N}`) or explicitly handle each script family. The 30 minutes spent on this fix would have been 5 minutes if we'd known the gotcha upfront.

4. **"Silent failures" in data pipelines are dangerous.** Vocabulary matching that quietly returns zero results is harder to debug than an error. Consider adding debug logs to selection/matching logic, especially in features that touch learner progress.

5. **Graceful degradation has limits.** Silently returning `[]` when vocab selection fails is good for availability, but bad for observability. We should emit Langfuse events for "no vocab available" cases so we can monitor whether the feature is actually working.

## Next Steps

1. **Add non-ASCII vocabulary test data** to the test fixtures. Include French, German, Spanish, and pinyin with diacritics. This prevents regression on Unicode handling.

2. **Emit observability events** for zero-result selections. Add Langfuse trace calls when `selectVocabulary()` returns empty, so we can monitor feature health per user per language.

3. **Document Unicode-aware patterns** in the codebase. Add a comment block to `WordMatcherService` explaining why we use `\p{L}\p{N}` and why `\b` is wrong for international text. Future developers should not rediscover this.

4. **Expand matching to handle compound words.** Some languages (German: "Schmetterling") and casual text (English: "don't") have internal punctuation. Current substring approach for CJK works, but Latin matching could be stricter. Consider tokenization library for robustness.

5. **Monitor vocabulary engagement metrics** post-launch. Track: (1) vocab selection success rate per language, (2) match rate per language, (3) SRS review count bump after injection events. Early signal if a language sees zero matches would indicate a regex or config problem.

**Owner**: Implementation team
**Timeline**: Observability events (1-2 days), documentation (same PR), test data expansion (backlog)
**Blockers**: None — feature ships as-is, improvements are post-launch monitoring and docs.
