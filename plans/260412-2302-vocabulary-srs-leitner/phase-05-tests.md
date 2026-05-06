# Phase 05: Tests (Unit + Integration + Regression)

## Context Links
- Reference test: `src/modules/ai/services/learning-agent-correction.service.spec.ts`

## Overview
- Priority: P1
- Status: pending
- Effort: M (2h)

Write unit tests for Leitner logic, session store, both services + regression test for translate-word auto-save.

## Requirements

**Coverage targets**
- `leitner.ts` — 100% branch coverage (pure function, trivial)
- `ReviewSessionStore` — TTL, ownership, not-found, expired
- `VocabularyService` — list filters, findOne 404, remove 404
- `VocabularyReviewService` — start filters, rate happy path, rate branches (not-in-session, already-rated, vocab-not-found, Leitner correctness), complete stats
- Regression: `TranslationService.translateWord()` still upserts vocab with `box=1, dueAt` default

## Architecture

### Test files

**`leitner.spec.ts`** — pure function tests:
```
describe('applyLeitner')
  it('promotes box 1 → 2 with +3 days on correct')
  it('promotes box 2 → 3 with +7 days on correct')
  it('promotes box 3 → 4 with +14 days on correct')
  it('promotes box 4 → 5 with +30 days on correct')
  it('caps at box 5 with +30 days on correct at box 5')
  it('resets any box to 1 with +1 day on wrong')
  it('uses injected `now` for deterministic tests')
```

**`review-session-store.spec.ts`**:
```
describe('ReviewSessionStore')
  it('creates session with UUID')
  it('returns session for owner')
  it('throws ForbiddenException for non-owner')
  it('throws NotFoundException for unknown session')
  it('throws NotFoundException for expired session')
  it('sweeps expired sessions')
  it('deletes session on complete')
```

**`vocabulary.service.spec.ts`**:
```
describe('VocabularyService')
  describe('list')
    it('filters by userId')
    it('filters by languageCode / box / search')
    it('paginates correctly')
    it('returns empty list + total=0 for no matches')
  describe('findOne')
    it('returns item for owner')
    it('throws NotFoundException for other user')
    it('throws NotFoundException for missing id')
  describe('remove')
    it('deletes for owner')
    it('throws NotFoundException when affected=0')
```

**`vocabulary-review.service.spec.ts`**:
```
describe('VocabularyReviewService')
  describe('start')
    it('returns due cards for user')
    it('filters by languageCode')
    it('applies limit')
    it('creates session with returned card ids')
    it('returns empty cards when nothing due')
  describe('rate')
    it('applies Leitner + persists vocab')
    it('increments reviewCount + correctCount (on correct)')
    it('increments reviewCount only (on wrong)')
    it('throws BadRequestException when card not in session')
    it('throws BadRequestException when already rated')
    it('throws NotFoundException when vocab missing')
    it('decrements remaining')
  describe('complete')
    it('returns accurate stats (total, correct, wrong, accuracy)')
    it('returns boxDistribution')
    it('deletes session after complete')
    it('handles empty session (0 ratings) gracefully')
```

### Regression test
Existing `translation.service.spec.ts` (if exists) OR new test case:
```
describe('TranslationService.translateWord (regression)')
  it('creates new vocab with box=1 and dueAt set')
  it('upsert updates translation on existing (user, word, sourceLang, targetLang)')
  it('does not reset box on re-translate of existing word')
```

**Key**: `orUpdate` must NOT include `box`/`due_at`/`last_reviewed_at`/`review_count`/`correct_count` in conflict columns (else re-translate resets SRS state).

## Related Code Files

**Create**
- `src/modules/vocabulary/services/leitner.spec.ts`
- `src/modules/vocabulary/services/review-session-store.spec.ts`
- `src/modules/vocabulary/services/vocabulary.service.spec.ts`
- `src/modules/vocabulary/services/vocabulary-review.service.spec.ts`

**Modify**
- `src/modules/ai/services/translation.service.spec.ts` — add/update regression tests (create if missing)

## Implementation Steps

1. Write `leitner.spec.ts` — pure, no mocks needed.
2. Write `review-session-store.spec.ts` — use fake timers (`jest.useFakeTimers()`) for TTL tests.
3. Write `vocabulary.service.spec.ts` — mock `Repository<Vocabulary>` via `getRepositoryToken`.
4. Write `vocabulary-review.service.spec.ts` — mock repo + inject real `ReviewSessionStore` (or mock).
5. Verify/update `translation.service.spec.ts` regression.
6. `npm test -- vocabulary` passes.
7. `npm test -- translation` passes.
8. `npm test` full suite passes — no regressions.
9. `npm run test:cov` — coverage report.

## Todo List

- [ ] Write `leitner.spec.ts` with 100% branch coverage
- [ ] Write `review-session-store.spec.ts` with fake timers for TTL
- [ ] Write `vocabulary.service.spec.ts`
- [ ] Write `vocabulary-review.service.spec.ts` covering all branches
- [ ] Add regression tests to `translation.service.spec.ts`
- [ ] `npm test` full suite passes
- [ ] Coverage on new files ≥ 85%

## Success Criteria

- All tests pass 3 consecutive runs (no flakiness)
- Coverage report shows ≥ 85% on `src/modules/vocabulary/**`
- `leitner.ts` at 100% branch coverage
- Regression test proves SRS state preserved on re-translate

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Fake timer tests flaky | Use `jest.useFakeTimers('modern')` + explicit `advanceTimersByTime` |
| Mock QueryBuilder chain verbose | Factory helper `makeQb()` returning chainable jest.fn |
| Test DB pollution from integration tests | All tests use mocks; no real DB |

## Security Considerations
- Test that ownership bypass attempts rejected (session, vocab level)
- Test that session-id forging returns 404 (not leak existence)

## Next Steps
- Phase 06: Docs update
