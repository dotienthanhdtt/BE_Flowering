# Brainstorm: Vocabulary CRUD + Leitner SRS

**Date:** 2026-04-12
**Scope:** Two features in one plan — (1) expose vocabulary CRUD endpoints (auto-save already works), (2) add Leitner 5-box spaced repetition with server-driven review sessions.

---

## Problem Statement

Users accumulate vocabulary automatically when translating words via `POST /ai/translate` (type=WORD) — rows land in `vocabulary` table with `(userId, word, sourceLang, targetLang)` unique key. Two gaps:

1. **No read access**: users can't list/view/delete their own vocabulary. No `/vocabulary` endpoints exist.
2. **No learning loop**: vocabulary is write-only. Need spaced repetition so users actively review saved words.

## Requirements

**Functional**
- CRUD: list (with filters), get-by-id, delete.
- SRS: Leitner 5-box scheduling. New word starts at box 1. Correct → promote + longer interval. Wrong → reset to box 1.
- Review: server-driven session (start → rate N cards → complete with stats).
- Existing auto-save path must keep working post-migration.

**Non-functional**
- Files < 200 lines each.
- Reuse existing `Vocabulary` entity + `TranslationService` auto-save path.
- Index on `(user_id, due_at)` for fast due-query.

## Evaluated Approaches

### Algorithm choice
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Leitner 5-box** | KISS, ~30 LOC, proven pedagogy | Less granular than SM-2 | **CHOSEN** |
| SM-2 (Anki) | Per-card ease, fine-tuned intervals | More columns, more code | Rejected (YAGNI) |
| FSRS | Most accurate | Requires training; overkill | Rejected |

### Session storage
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **In-memory Map** | KISS, matches onboarding pattern | Lost on restart | **CHOSEN (MVP)** |
| DB table | Persistent, analytics | More code, migration | Later if needed |
| Redis | Multi-pod safe | Infra cost | YAGNI |

### Review UX
| Option | Verdict |
|---|---|
| **Binary correct/wrong** (Leitner-native) | **CHOSEN** |
| 3-tier (wrong/hard/easy) | Rejected — mismatched with Leitner semantics |
| AI-generated quiz per card | Rejected — LLM cost per card; client can build quiz UI |

## Chosen Solution

### Endpoints (all JWT-protected)

**CRUD**
- `GET /vocabulary?languageCode=&box=&search=&page=&limit=` — paginated list
- `GET /vocabulary/:id` — single card
- `DELETE /vocabulary/:id` — remove

**SRS Review**
- `POST /vocabulary/review/start` — Body: `{ languageCode?, limit?=20 }` → `{ sessionId, cards[], total }`
- `POST /vocabulary/review/:sessionId/rate` — Body: `{ vocabId, correct }` → `{ updated: { box, dueAt }, remaining }`
- `POST /vocabulary/review/:sessionId/complete` — `{}` → `{ total, correct, wrong, accuracy, boxDistribution }`

### Schema Additions to `vocabulary`
| Column | Type | Default |
|---|---|---|
| `box` | smallint | 1 |
| `due_at` | timestamptz | NOW() |
| `last_reviewed_at` | timestamptz | NULL |
| `review_count` | int | 0 |
| `correct_count` | int | 0 |

Index: `idx_vocabulary_user_due ON vocabulary(user_id, due_at)`.

Backfill existing rows: `UPDATE vocabulary SET box=1, due_at=NOW() WHERE box IS NULL`.

### Leitner State Transition
```
correct: box N  → box min(N+1, 5), due = NOW + intervals[newBox]
wrong:   box N  → box 1,           due = NOW + 1 day
```

Intervals (days): `{1: 1, 2: 3, 3: 7, 4: 14, 5: 30}`.

### Session State
In-memory `Map<sessionId, { userId, cardIds[], ratings: Map<vocabId, boolean>, startedAt }>` with 1h TTL sweep. Lost on restart — acceptable.

### Module Structure
```
src/modules/vocabulary/
  vocabulary.module.ts
  vocabulary.controller.ts           — CRUD
  vocabulary-review.controller.ts    — SRS
  services/
    vocabulary.service.ts
    vocabulary-review.service.ts     — Leitner + session
    review-session-store.ts          — in-memory Map + TTL
  dto/
    vocabulary-query.dto.ts
    vocabulary-response.dto.ts
    review-start.dto.ts
    review-rate.dto.ts
    review-response.dto.ts
```

## Implementation Considerations & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Auto-save breaks on new columns | Low | High | Columns default-valued; `orUpdate` targets existing keys only. Add regression test. |
| In-memory session lost on restart | Med | Low | Document limitation; user re-starts review. |
| Multi-pod deploy splits sessions | Low | Med | Single pod today. Move to DB/Redis if scaled. |
| Box 5 still reviewed indefinitely | Low | Low | Intentional for retention. Add `mastered` flag later if UX demands. |
| Timezone confusion on due_at | Low | Low | Store UTC. Client formats local. |
| Large vocab list slow | Low | Low | Pagination + index on `(user_id, due_at)`. |

## Success Metrics
- `GET /vocabulary` returns paginated list < 200ms p95 for 1000-card user.
- `POST /review/start` returns due cards < 300ms p95.
- `POST /review/rate` updates box + dueAt correctly per Leitner rules (covered by unit tests).
- Auto-save regression test passes (existing translate-word still creates/updates vocab with `box=1, dueAt=NOW`).
- 100% branch coverage on `LeitnerService.promote/reset` logic.

## Validation Criteria
- Unit tests: Leitner state transitions (promote to each box, wrong from each box, cap at box 5).
- Unit tests: Session store TTL, orphan session rejection.
- Integration test: full review cycle start → rate 3 cards → complete → verify boxDistribution.
- Regression: `POST /ai/translate` type=word still upserts vocab with SRS defaults.

## Next Steps & Dependencies
1. Plan phase: file-by-file breakdown + migration + test phases.
2. No external dependencies; all in-house.
3. Post-MVP follow-ups: DB-backed session for multi-pod, SM-2 upgrade if Leitner feels too blunt, `mastered` flag, daily review cap, AI-generated quiz questions.

## Unresolved Questions
- Should review session allow mixed-language cards, or always require `languageCode` filter? **Default: optional filter**, user chooses.
- Should re-reviewing an already-rated card within same session update or reject? **Default: reject** (one rating per card per session).
- Any rate-limit on review endpoints? **Default: none** (rate limit only on AI-powered endpoints).
- Exposing `correct_count`/`review_count` in list response — useful stats or noise? **Default: include**, client can hide.
