---
phase: 6
title: "Tests"
status: pending
priority: P1
effort: "4h"
dependencies: [5]
---

# Phase 6: Tests

## Overview

Comprehensive unit + integration coverage for the new endpoint. Tests verify the FINAL code (post-refactor). No mocks for DB schemas — use real repos against test PG. LLM calls are mocked (deterministic JSON output).

## Test Surface

### Unit: `scenario-evaluator.service.spec.ts`
- [ ] Valid JSON output → parsed result
- [ ] Markdown-fenced JSON → stripped + parsed
- [ ] Malformed JSON → throws `EvaluatorError('parse_failed')`
- [ ] Missing required fields → throws `EvaluatorError`
- [ ] Out-of-range scores (e.g. 150) → clamped to 100
- [ ] Negative scores → clamped to 0
- [ ] 9router unavailable → falls back to Gemini

### Unit: `scenario-complete.service.spec.ts`
- [ ] Happy path: CHATTING conversation → DONE + evaluation row inserted + response shape
- [ ] Idempotent replay: existing eval row → returns cached, no LLM call (assert spy)
- [ ] DONE conversation without eval → still runs evaluator, inserts row
- [ ] LLM failure (EvaluatorError) → response has `evaluation: null` + `evaluation_error` (enum code), status still DONE
- [ ] **`evaluation_error` is a closed enum code, never contains raw LLM payload or stack trace** _[Red Team #13]_
- [ ] LLM timeout (15s) → `evaluation_error: 'timeout'` _[Red Team #14]_
- [ ] **Retry cap: 3 failed `/complete` calls → 4th returns cached `evaluation_error` without invoking LLM** _[Red Team #7]_
- [ ] Personalization trigger called exactly once on success path
- [ ] Personalization trigger NOT called on idempotent replay
- [ ] Personalization trigger failure swallowed (no propagation)
- [ ] Race: 2 concurrent calls → 1 row, 1 LLM call (advisory lock asserted via mock query spy) _[Red Team #2]_
- [ ] Guard: scenarioId mismatch → BadRequestException
- [ ] Guard: wrong user → ForbiddenException
- [ ] **Guard: IDOR — attacker's userId + victim's conversationId + scenario attacker can access → ForbiddenException** _[Red Team #4]_
- [ ] Guard: nonexistent conversation → NotFoundException
- [ ] Response excludes `model_used`, `prompt_version`, `created_at`, internal IDs (whitelist enforcement) _[Red Team #12]_

### Unit: `scenario-chat.service.spec.ts` (UPDATED)
- [ ] Existing trigger-on-chat-DONE tests **remain** (dual-fire kept during transition per Red Team #3)
- [ ] New: chat-induced DONE also sets `completedAt` _[Red Team #5]_
- [ ] All other chat tests still pass

### E2E: `test/scenario-complete.e2e-spec.ts` (new)
- [ ] POST /scenario/complete with valid body → 200 + expected shape
- [ ] POST without auth → 401
- [ ] POST with wrong scenarioId for conversation → 400
- [ ] POST twice → 2nd returns cached eval (same id, same timestamp)
- [ ] Swagger schema matches DTO

## Related Code Files

- Modify: `src/modules/scenario/services/scenario-chat.service.spec.ts`
- Create: `src/modules/scenario/services/scenario-complete.service.spec.ts` (already scaffolded in Phase 4)
- Create: `src/modules/scenario/services/scenario-evaluator.service.spec.ts` (already scaffolded in Phase 3)
- Create: `test/scenario-complete.e2e-spec.ts`

## Implementation Steps

1. Write unit specs for evaluator first (no DB needed, all mocked LLM responses).
2. Write unit specs for complete service. Mock evaluator + personalization trigger. Use in-memory or test PG for repos.
3. Update chat service spec — strip removed trigger tests.
4. Write e2e spec using `nest-test` pattern from `test/` directory. Mock LLM provider.
5. Run `npm test` → all pass.
6. Run `npm run test:cov` → check new files >80% line coverage.
7. Run `npm run test:e2e` → all pass.

## Success Criteria

- [ ] All unit tests pass (`npm test`)
- [ ] E2E test passes (`npm run test:e2e`)
- [ ] Coverage on new service files ≥ 80% lines
- [ ] No skipped/pending tests committed
- [ ] CI green on push

## Risk Assessment

- **Risk:** E2E test depends on test PG with migrations applied.
  **Mitigation:** rely on existing test setup pattern (check `test/jest-e2e.json` + existing e2e files).
- **Risk:** Mocking LLM properly — must hit the same `UnifiedLLMService.chat()` signature.
  **Mitigation:** mirror mock pattern already used in `scenario-chat.service.spec.ts`.
- **Risk:** Test for race condition is flaky.
  **Mitigation:** use `Promise.all([complete(), complete()])` + assert final row count = 1; idempotency check + ON CONFLICT should be deterministic.
