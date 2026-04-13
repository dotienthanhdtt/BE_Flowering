---
title: "Vocabulary CRUD + Leitner SRS"
description: "Expose /vocabulary CRUD endpoints + add Leitner 5-box spaced repetition with server-driven review sessions."
status: pending
priority: P1
effort: 8h
branch: dev
tags: [vocabulary, srs, leitner, spaced-repetition, nestjs]
created: 2026-04-12
brainstorm: plans/reports/brainstorm-260412-2302-vocabulary-srs-leitner.md
blockedBy: []
blocks: []
---

# Vocabulary CRUD + Leitner SRS

## Summary

Two features in one plan:
1. **Vocabulary CRUD** — `GET /vocabulary`, `GET /vocabulary/:id`, `DELETE /vocabulary/:id`. Auto-save already works via `POST /ai/translate` (type=WORD).
2. **Leitner 5-box SRS** — new vocabulary starts in box 1. Review sessions (`/vocabulary/review/*`) present due cards, accept binary ratings, promote/reset boxes with scheduled `due_at`.

## Architecture Decisions

- **Leitner over SM-2** — simpler, sufficient for MVP. ~30 LOC of state logic.
- **In-memory review sessions** — KISS, matches onboarding pattern. 1h TTL. Accept restart loss.
- **Binary rating** — Leitner-native; no ease tier.
- **Reuse existing `Vocabulary` entity** — add 5 SRS columns + index. Existing rows backfilled to `box=1, due_at=NOW()`.
- **New `VocabularyModule`** — split CRUD/review controllers for separation of concerns.
- **No rate limit on review endpoints** — not AI-powered.

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | DB migration + entity SRS fields | pending | S | phase-01-database-migration.md |
| 2 | VocabularyService (CRUD) + controller | pending | M | phase-02-vocabulary-crud.md |
| 3 | Leitner logic + review session store | pending | M | phase-03-leitner-review-service.md |
| 4 | Review controller + DTOs + module wiring | pending | S | phase-04-review-controller-module.md |
| 5 | Tests (unit + integration + regression) | pending | M | phase-05-tests.md |
| 6 | Docs update (API + changelog) | pending | S | phase-06-docs.md |

## Key Dependencies

- **Existing entities**: `Vocabulary`, `User`
- **Existing services**: `TranslationService` (verify auto-save still works post-migration)
- **External**: None

## Leitner Intervals

| Box | Next interval (correct) | On wrong |
|---|---|---|
| 1 → 2 | +3 days | → box 1, +1 day |
| 2 → 3 | +7 days | → box 1, +1 day |
| 3 → 4 | +14 days | → box 1, +1 day |
| 4 → 5 | +30 days | → box 1, +1 day |
| 5 → 5 | +30 days | → box 1, +1 day |

## Success Criteria

- `GET /vocabulary` returns paginated list < 200ms p95 for 1000-card user
- `POST /vocabulary/review/start` returns correct due cards
- Leitner transitions unit-tested at 100% branch coverage
- Auto-save regression: `POST /ai/translate` type=word still creates vocab with `box=1, due_at=NOW`
- All tests pass, `npm run build` + `npm run lint` clean

## Open Items (from brainstorm)
1. Mixed-language review sessions vs force `languageCode` filter — defaulting to optional filter
2. Re-rate within same session — defaulting to reject (one rating per card per session)
3. Review rate-limits — none (non-AI endpoint)
4. Surface `correct_count`/`review_count` in list response — yes, include
