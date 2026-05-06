# Phase 05 — Tests & E2E

## Context Links

- Brainstorm: `plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md` (§8 success criteria)
- Phase 02/04 unit specs already authored — this phase covers integration + e2e + `ScenarioChatService` unit spec updates
- Reference e2e style: `test/language-specific-levels.e2e-spec.ts`
- Existing service spec: `src/modules/scenario/services/scenario-chat.service.spec.ts`

## Overview

- **Priority:** P1 (gates merge)
- **Status:** done
- **Brief:** Update `scenario-chat.service.spec.ts` for new injection branches; add integration spec for `VocabularyInjectionService` against test DB; write e2e `scenario-chat-vocab-injection.e2e-spec.ts` covering all edge cases from brainstorm §5.

## Key Insights

- Unit mocks in existing `scenario-chat.service.spec.ts` need extension for `VocabularyInjectionService`, `VocabularyInjectionEvent` repo, `VocabularyReviewService`.
- Phase 02 spec covers bucket logic with mocks. Real-DB integration spec validates `NULLS FIRST` + `ANY(:ids)` behavior the mock can't.
- E2E must seed `Vocabulary` rows + active `UserLanguage` + scenario + accessible-scenario record. Factor seed helpers in `test/helpers/seed-vocab.ts`.
- E2E must NOT call the real LLM. Existing e2e infrastructure likely mocks `UnifiedLLMService` — follow same pattern (`test/language-specific-levels.e2e-spec.ts` as reference; confirm mock setup during implementation).
- Assert behavior via DB state + response payload, not LLM-text content.

## Requirements

### Functional
- Unit spec for `ScenarioChatService` covers:
  - Turn-1 with vocab → calls `selectVocabularyForConversation`, sets `injectedVocabIds` on saved conversation.
  - Turn-2 with cached IDs → calls `hydrateByIds`, NOT `selectVocabularyForConversation`.
  - Turn-1 selection throws → conversation still saves with `injectedVocabIds=[]`, response still returns.
  - User message contains injected word → event row created with `wasUsed=true`; `touchReviewed` called once.
  - User message no match → events rows all `wasUsed=false`; `touchReviewed` NOT called.
  - Empty `dto.message` → `trackUsage` early-returns; no event rows.
- Integration spec for `VocabularyInjectionService`:
  - Seed 8 vocab rows across boxes 1-5, various `lastReviewedAt` values (some NULL, some past, some recent).
  - Assert bucket A returns 5 with NULL-first + chronological order.
  - Assert bucket B returns only rows where `dueAt <= NOW()` and `box <= 4`.
  - Assert dedup on overlap.
  - Assert `targetLang` filter isolates per-language.
  - Assert `hydrateByIds` returns rows in input order.
- E2E spec covers:
  - (a) User with 0 vocab → `injected_vocab_ids = []`, no events rows, 200 response.
  - (b) User with 3 vocab, message contains 1 word → events rows = 3 (1 used, 2 unused), `reviewCount` of the used row = +1, `box` unchanged.
  - (c) User with all-mastered vocab (box=5) → both buckets empty, `[]` persisted.
  - (d) Turn-2 does not recompute: manually set `injected_vocab_ids=[uuidX]`, add new vocab rows mid-conversation, send turn-2 msg — confirm injected list still only `[uuidX]`.
  - (e) Language filter: user has `en` + `es` vocab, active language = `en`, confirm only `en` IDs selected.
  - (f) Multiple turns: turn-1 selects, turn-2 hydrates, turn-3 still uses same IDs.

### Non-Functional
- All unit specs run under existing `npm test` suite.
- E2E runs via `npm run test:e2e`.
- Integration spec uses real Postgres test DB (follow existing e2e DB setup).
- No real LLM calls — mock `UnifiedLLMService.chat` to return deterministic reply.

## Architecture

### Test Matrix

| Layer | File | Scope | Cases |
|-------|------|-------|-------|
| Unit (Phase 02) | `vocabulary-injection.service.spec.ts` | Pure bucket logic + merge + hydrate | 7 |
| Unit (Phase 04) | `vocabulary-usage-matcher.spec.ts` | Word matching | 6 |
| Unit (Phase 05) | `scenario-chat.service.spec.ts` (extended) | Service branches + wiring | 6 new |
| Integration | `vocabulary-injection.service.integration.spec.ts` | Real DB query correctness | 5 |
| E2E | `test/scenario-chat-vocab-injection.e2e-spec.ts` | Full request lifecycle | 6 |

## Related Code Files

### Create
- `src/modules/scenario/services/vocabulary-injection.service.integration.spec.ts`
- `test/scenario-chat-vocab-injection.e2e-spec.ts`
- `test/helpers/seed-vocab.ts` (if no existing helper for vocab seeding)

### Modify
- `src/modules/scenario/services/scenario-chat.service.spec.ts` — add new mocks + 6 new cases

### Delete
- none

## Implementation Steps

1. **Extend** `scenario-chat.service.spec.ts`:
   - Add mocks:
     ```ts
     const mockVocabInjection = () => ({
       selectVocabularyForConversation: jest.fn().mockResolvedValue([]),
       hydrateByIds: jest.fn().mockResolvedValue([]),
     });
     const mockEventsRepo = () => ({
       create: jest.fn(dto => dto),
       save: jest.fn(rows => Promise.resolve(rows)),
     });
     const mockVocabReview = () => ({ touchReviewed: jest.fn().mockResolvedValue(undefined) });
     ```
   - Register them in `Test.createTestingModule(...providers)` + repo tokens.
   - 6 new test blocks matching cases listed under Functional.
   - For fire-and-forget assertion: use `await new Promise(setImmediate)` after `chat()` to flush microtasks before asserting.

2. **Write integration spec** `vocabulary-injection.service.integration.spec.ts`:
   - Spin up a `Test.createTestingModule` with `TypeOrmModule.forRoot` pointing to test DB.
   - Seed user + 8 vocab rows via repo save.
   - Assert bucket results. Clean up in `afterEach` (truncate `vocabulary`).

3. **Write E2E** `test/scenario-chat-vocab-injection.e2e-spec.ts`:
   - Follow `test/language-specific-levels.e2e-spec.ts` setup (auth helper, `supertest` agent).
   - Seed scenario + language + user-language via helpers.
   - Mock `UnifiedLLMService` provider (override in `Test.overrideProvider(UnifiedLLMService).useValue({ chat: async () => 'stub reply' })`).
   - 6 `it()` blocks per matrix.
   - Assert DB state via injected `DataSource` / raw `psql`-style queries.
   - For case (b), after 200 response: `await new Promise(r => setTimeout(r, 100))` to let fire-and-forget writes settle, then query `vocabulary_injection_events` + `vocabulary`.

4. **Seed helper** `test/helpers/seed-vocab.ts` (only if none exists):
   - `seedVocabRows(dataSource, userId, rows: Partial<Vocabulary>[])`.

5. **Run full test suite**:
   - `npm test` — all unit pass.
   - `npm run test:e2e` — all e2e pass.
   - `npm run lint` — clean.

6. **Performance sanity check (manual, logged in PR description, not asserted in code)**:
   - Time `/scenario/chat` turn-1 vs baseline branch — confirm added latency ≤ 50ms with 100-word vocab user.

## Todo List

- [ ] Extend `scenario-chat.service.spec.ts` with 6 new cases
- [ ] Create `vocabulary-injection.service.integration.spec.ts` with 5 cases
- [ ] Create e2e `test/scenario-chat-vocab-injection.e2e-spec.ts` with 6 cases
- [ ] Create/reuse `test/helpers/seed-vocab.ts`
- [ ] `npm test` all green
- [ ] `npm run test:e2e` all green
- [ ] `npm run lint` clean
- [ ] `npm run build` clean
- [ ] Manual latency spot-check noted in PR

## Success Criteria

- 0 failing tests across unit + e2e.
- Coverage for `VocabularyInjectionService` ≥ 90% (bucket logic fully exercised).
- Coverage for `trackUsage` path ≥ 80% (happy + error + empty branches).
- E2E verifies brainstorm §5 edge-case table line-by-line (7/7 cases).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fire-and-forget assertions flake due to timing | Med | Med | Use `setImmediate`/`setTimeout(r, 100)` flush pattern; if still flaky, export an internal `trackUsagePromise` getter for tests |
| E2E DB state leak between tests | Med | High | `beforeEach` truncate of `ai_conversations`, `vocabulary_injection_events`, `vocabulary` |
| Real LLM accidentally invoked in e2e | Low | High | Override `UnifiedLLMService` provider; verify module override in setup |
| Test DB missing Phase 01 migrations | Low | High | Ensure e2e bootstrap runs `migration:run` on test DB before suite |
| Integration spec NULLS-FIRST assertion depends on PG version | Low | Low | Supabase + local dev both ≥14; acceptable |

## Security Considerations

- Seed helpers generate random UUIDs, no real user data.
- Test DB config must NEVER point to production. Gate via `NODE_ENV !== 'production'` assertion in bootstrap.
- Mock LLM prevents external API cost + data exfiltration during CI.

## Next Steps

- After all phases green: delegate `code-reviewer` per primary-workflow §3.
- `docs-manager` to update `docs/project-changelog.md` + `docs/api-documentation.md` (scenario-chat endpoint gains vocab-awareness note).
- If post-launch analytics show low `was_used` rate → revisit soft-hint prompt wording (separate ticket).
