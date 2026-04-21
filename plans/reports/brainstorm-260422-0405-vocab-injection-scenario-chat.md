---
type: brainstorm
date: 2026-04-22
branch: feat/personalized-feature
slug: vocab-injection-scenario-chat
status: approved
---

# Brainstorm — Personalized Vocabulary Injection in Scenario Chat

## 1. Problem Statement

`POST /scenario/chat` currently has zero vocabulary personalization. Prompt template `scenario-chat-prompt.json` only receives scenario metadata + user proficiency level. Goal: inject words user is learning / likely to forget so AI can weave them naturally into replies, reinforcing recognition/recall mid-conversation.

**Core question:** which words to select from `Vocabulary` table for prompt injection?

## 2. Context Snapshot

- **Vocabulary entity** (`src/database/entities/vocabulary.entity.ts`): Leitner SRS fields already present — `box` (1–5), `dueAt`, `lastReviewedAt`, `reviewCount`, `correctCount`. Source: `TranslationService.translateWord` upserts on authenticated tap-to-translate.
- **Scenario chat** (`src/modules/scenario/services/scenario-chat.service.ts:96-108`): loads prompt template, injects scenario + user language context, calls LLM. No vocab hook.
- **Prompt file**: `src/modules/ai/prompts/scenario-chat-prompt.json`.
- **AiConversation entity**: turn-by-turn persistence exists; no dedicated vocab-cache column.

## 3. Evaluated Approaches

### A. Pure SRS (due-for-review only)
Pros: uses existing SRS; scientifically grounded.
Cons: static top-N rotates slowly; no variety for active users; ignores newly-added words.

### B. Scenario-relevant filtering (tag by category)
Pros: topically coherent.
Cons: requires category tagging on every translate + backfill migration. **Rejected** — scope creep, cold-start data gap.

### C. 50/50 recency + SRS hybrid (chosen)
Pros: balances "reinforce what you just learned" with "revive what you're forgetting"; cheap queries; existing schema.
Cons: recent-by-createdAt goes stale for inactive users → fixed via **last-reviewed rotation** variant.

### D. Random sample from still-learning pool
Pros: fresh every conversation; skips mastered.
Cons: loses recency signal; pure randomness = no ordering discipline.

**Decision: Approach C with `lastReviewedAt` rotation for anti-staleness.**

## 4. Final Design

### 4.1 Selection Algorithm

**Bucket A — Rotation (5 words)**
```sql
SELECT * FROM vocabulary
WHERE user_id = :uid
  AND target_lang = :lang
  AND box < 5                          -- exclude mastered
ORDER BY last_reviewed_at ASC NULLS FIRST
LIMIT 5;
```
Why `NULLS FIRST`: words never reviewed (translate-only) surface first. Rotation property: a word won't reappear until every other non-mastered word has cycled through.

**Bucket B — SRS urgency (5 words)**
```sql
SELECT * FROM vocabulary
WHERE user_id = :uid
  AND target_lang = :lang
  AND due_at <= NOW()
  AND box <= 4                         -- exclude mastered
ORDER BY correct_count ASC, due_at ASC
LIMIT 5;
```
Strict order — top 5 most-forgotten always.

**Merge:** dedup by `id`. No backfill when total < N. Inject whatever exists (even empty).

### 4.2 Lifecycle + Caching

- **Compute on turn 1** of each scenario conversation.
- **Persist** selected IDs in new column `AiConversation.injected_vocab_ids uuid[]`.
- **Subsequent turns**: hydrate via `SELECT * FROM vocabulary WHERE id = ANY(:ids)`.
- Consistency > freshness within a session. New conversation = fresh pick.

### 4.3 Prompt Integration

Add variable `userVocabulary: Array<{ word, translation, box }>` to `scenario-chat-prompt.json`. Soft-hint wording:

> User's active vocabulary (currently learning or needs review):
> `{{userVocabulary}}`
>
> Where it fits naturally in this scenario, weave one or two of these words into your reply to reinforce recognition. Do not force usage if it feels awkward.

### 4.4 Configuration

```ts
// src/modules/scenario/config/vocab-injection.config.ts
export const VOCAB_INJECTION_CONFIG = {
  totalWords: 10,
  recentBucketSize: 5,
  srsBucketSize: 5,
  maxBoxForSrs: 4,      // Bucket B cap
  maxBoxForRotation: 4, // Bucket A cap (box < 5)
};
```

### 4.5 Analytics Hook — Injected vs Used Tracking

Per-turn, after user submits message:
1. Load `AiConversation.injected_vocab_ids`.
2. Token-match user message against injected word strings (case-insensitive, basic word-boundary match; locale-aware tokenization later).
3. Persist hits to new table `vocabulary_injection_events` (columns: `id`, `conversation_id`, `turn_index`, `vocabulary_id`, `was_used`, `created_at`).
4. Future use: boost `correctCount` or advance `box` for used words (separate decision, out of this brainstorm).

## 5. Edge Cases

| Case | Behavior |
|---|---|
| 0 vocab total | Inject empty array `[]` — prompt handles gracefully |
| 3 words total | Inject all 3 |
| All mastered (box=5) | Both buckets empty → inject `[]` |
| Target lang mismatch | Filtered out by `target_lang = :lang`, inject what matches |
| Word added mid-conversation | Not reflected until next conversation (consistency wins) |
| Same word in both buckets | Dedup by ID → count toward one slot |

## 6. Files Affected (Indicative, Planner Confirms)

**Create**
- `src/modules/scenario/services/vocabulary-injection.service.ts` — bucket queries + merge
- `src/modules/scenario/config/vocab-injection.config.ts` — tunable constants
- Migration: `add-injected-vocab-ids-to-ai-conversations.ts`
- Migration: `create-vocabulary-injection-events-table.ts`
- Entity: `vocabulary-injection-event.entity.ts`

**Modify**
- `src/database/entities/ai-conversation.entity.ts` — add `injectedVocabIds` column
- `src/modules/scenario/services/scenario-chat.service.ts` — inject vocab at turn 1, hydrate subsequent turns, track usage post-reply
- `src/modules/ai/prompts/scenario-chat-prompt.json` — add `userVocabulary` variable + soft-hint instruction
- `src/modules/scenario/scenario.module.ts` — wire new service
- `src/database/database.module.ts` — register new entity

## 7. Risks + Mitigations

| Risk | Mitigation |
|---|---|
| Topical irrelevance (food word in job interview) | Soft hint — AI skips awkward fits |
| Token cost | ~75 tokens extra per prompt — negligible |
| Slow query as user vocab grows | Index `(user_id, target_lang, last_reviewed_at)` + `(user_id, target_lang, due_at, box)` |
| Turn-1 computation fails | Fall back to empty array; don't block chat |
| Usage-tracking false positives (stem mismatches) | Start with exact+lowercase match; iterate later |
| Analytics write blocks response | Fire-and-forget async insert after reply returned |

## 8. Success Criteria

1. `/scenario/chat` prompt receives 0–10 words personalized per user per conversation without latency regression (<50ms added to turn 1).
2. Config change (e.g., `totalWords: 5`) takes effect without code edits outside config file.
3. `vocabulary_injection_events` rows accumulate for each conversation with ≥1 injected word.
4. No runtime errors for users with 0 vocab, all-mastered vocab, or language mismatch.
5. Token-budget unchanged by more than ~100 tokens/turn vs baseline.

## 9. Dependencies

- Existing `Vocabulary` SRS fields (ready).
- `AiConversation` entity accessible from scenario chat (confirmed, line 96-108).
- Langfuse tracing — no changes; new variable flows through existing `invokePromptTemplate` path.

## 10. Next Steps

1. If approved → run `/ck:plan` with this brainstorm as context; plan will cover migrations, service wiring, prompt update, tests.
2. Planner to decide Bucket A/B query execution (`UNION ALL` single query vs two queries + merge in code).
3. Planner to confirm `AiConversation.injectedVocabIds` column type (`uuid[]` vs JSONB) per existing conventions.

## 11. Unresolved Questions

- **Stemming/lemmatization for "was used" detection** — is naive lowercase substring match acceptable for MVP across target languages (e.g., Japanese/Chinese without spaces)? Likely needs language-aware tokenization; defer to analytics phase. -> yes
- **Should `lastReviewedAt` be updated when a word is injected (not just reviewed)?** If yes, Bucket A rotates faster but conflates "exposed in chat" with "reviewed". Current recommendation: leave untouched — injection ≠ review. -> if a word was use in conversation it mean this word was review, same with vocabulary review
- **Box advancement on successful use** — should using an injected word in chat count as a correct SRS attempt? Defer — separate feature decision.-> no
