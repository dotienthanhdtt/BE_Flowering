---
phase: 4
title: "Complete Service"
status: completed
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 4: Complete Service

## Overview

`ScenarioCompleteService` orchestrates: guards → idempotent replay check → DONE flip → evaluator → INSERT ON CONFLICT → fire personalization trigger → response shape. This is the brain of the endpoint.

## Requirements

- Idempotent: N repeat calls → 1 evaluation row, 1 LLM call
- Atomic: status flip + eval insert in a single transaction (or independent + ON CONFLICT safety)
- Graceful: LLM failure → return DONE + `evaluation: null + evaluation_error`, do NOT rollback DONE
- Fire-and-forget: personalization trigger never blocks/fails response

## Architecture

```
complete(userId, dto, languageId): ScenarioCompleteResponseDto
  1. scenario = scenarioAccessService.findAccessibleScenario(...)
  2. conversation = resolveExisting(userId, dto.conversationId, scenario.id)
     // resolveExisting (from chat service) enforces: userId match (403),
     // scenarioId match (400), existence (404). MANDATORY — covers IDOR.
  3. cached = evalRepo.findOne({ where: { conversationId } })
     if cached: return buildResponse(conversation, cached)  // no LLM, no trigger
  4. dataSource.transaction(async tx => {
       // Advisory lock — MANDATORY, not optional. Prevents concurrent
       // /complete calls from each invoking LLM separately.
       await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',
                      [`complete:${conversation.id}`]);
       // Re-check cache inside lock
       const insideLock = await tx.findOne(ScenarioEvaluation, ...);
       if (insideLock) return insideLock;
       if (status !== DONE) {
         conversation.status = DONE;
         conversation.completedAt = new Date();
         await tx.save(conversation);
       }
       try {
         result = await evaluator.evaluate({ scenario, ..., scenarioId: scenario.id });
         //                                            ^ asserted non-null from resolveExisting
         await tx.insert(ScenarioEvaluation, mapToEntity(result));
       } catch (EvaluatorError as e) {
         // Insert tombstone to cap retries (error_count++, stop at 3).
         await tx.upsert(ScenarioEvaluation, { conversation_id, error_count, last_error_code });
         return null;  // signal failure to outer scope
       }
     });
  5. if evaluation null: return buildResponse(conversation, null, errorCode)
  6. void personalizationTrigger.maybeTrigger(userId, scenario.id)
     // No .catch(log) — service already swallows internally (see trigger:22-29).
  7. return buildResponse(conversation, evaluation)
```

_[Red Team #2, #4, #7, #10 applied]_

## Failed-Evaluation Tombstone (new sub-schema requirement)

Add to `scenario_evaluations` table in Phase 1:
- `error_count smallint NOT NULL DEFAULT 0`
- `last_error_code varchar(32) NULL`

Tombstone row created on first failure. Subsequent `/complete` calls:
- If `error_count < 3 && overall_score IS NULL` → retry evaluator
- If `error_count >= 3` → return cached `evaluation_error` without calling LLM (cap)
- On success → UPDATE row with scores and reset error_count

This is the **`scenario_evaluations` row may exist with NULL scores** state. UNIQUE(conversation_id) still holds. _[Red Team #7]_

## Related Code Files

- Create: `src/modules/scenario/services/scenario-complete.service.ts`
- Create: `src/modules/scenario/services/scenario-complete.service.spec.ts`

## Implementation Steps

1. Inject repos: `AiConversation`, `AiConversationMessage`, `ScenarioEvaluation`, `VocabularyInjectionEvent`.
2. Inject services: `ScenarioAccessService`, `ScenarioEvaluatorService`, `VocabularyInjectionService`, `LanguageService`, `PersonalizationTriggerService`.
3. **Helper duplication, no extraction.** Copy needed helpers (`loadHistory` ~10 lines, `loadLanguageContext` ~30 lines, `buildTranscriptDto` ~10 lines) into `ScenarioCompleteService` as private methods. Do NOT extract a shared helper service in this plan.
   - Rationale: `scenario-chat.service.ts` is 481 lines, the hottest service in the module, covered by 95+ tests. Extracting 4 methods + rewiring DI in mocks alongside a new endpoint = blast-radius nightmare in one PR.
   - `resolveInjectedVocabulary` in chat (lines 414-445) **mutates conversation state** (writes `injectedVocabIds` back). `/complete` should NOT re-run injection — it should READ-ONLY hydrate via `vocabInjection.hydrateByIds(conversation.injectedVocabIds ?? [])`. If `injectedVocabIds` is null, treat as empty (eval prompt's vocab-usage fallback in Phase 3 step 3 covers transcript re-match).
   - Defer helper extraction to a separate follow-up PR after `/complete` stabilizes. _[Red Team #11]_
4. Guards: 404 (scenario not accessible), 404 (conversation not found), 403 (wrong user), 400 (scenarioId mismatch).
5. Idempotency check via `evalRepo.findOne({ where: { conversationId } })` BEFORE LLM call.
6. DONE flip: only if `status !== DONE`. Set `completedAt`. Save.
7. Evaluator call wrapped in try/catch. On `EvaluatorError`: return response with `evaluation: null` + `evaluation_error: err.message`.
8. INSERT with `ON CONFLICT (conversation_id) DO NOTHING`:
   ```ts
   const inserted = await this.evalRepo.createQueryBuilder()
     .insert().into(ScenarioEvaluation).values({...})
     .orIgnore() // typeorm postgres equivalent
     .returning('*').execute();
   const evaluation = inserted.raw[0]
     ?? await this.evalRepo.findOne({ where: { conversationId } });
   ```
9. Fire-and-forget personalization trigger via `void ... .catch(log)`.
10. Response builder: assemble `{ scenario: {conversation_id, max_turns, turn, status}, messages: transcript[], evaluation: {...} | null, evaluation_error?: string }`.

## Helper Extraction — DEFERRED

Helper extraction is **out of scope** for this plan (see step 3 rationale). `/complete` duplicates 3 small helpers. Extraction tracked as a follow-up refactor PR. _[Red Team #11]_

## Success Criteria

- [ ] Idempotency: call /complete 3x → 1 row in `scenario_evaluations`, 1 LLM trace in Langfuse
- [ ] DONE flip works when called on CHATTING conversation
- [ ] DONE no-op when already DONE + no eval row → still triggers evaluation
- [ ] LLM failure → 200 response with `evaluation: null` + `evaluation_error`
- [ ] Personalization trigger fires (verify via spy in unit test)
- [ ] Race: 2 concurrent /complete calls → 1 row inserted (ON CONFLICT path covered)

## Risk Assessment

- **Risk:** Race condition — 2 concurrent /complete calls both pass `findOne` check, both call LLM, both INSERT.
  **Mitigation:** ON CONFLICT handles row insert. Wasted LLM call on duplicate is acceptable (rare). For stronger guarantee, wrap in advisory lock keyed by `complete:${conversationId}`.
- **Risk:** Helper extraction broadens scope of Phase 5 chat refactor.
  **Mitigation:** acceptable — refactor is mechanical, covered by existing `scenario-chat.service.spec.ts`.
- **Risk:** Transaction boundary unclear (DONE flip vs eval insert).
  **Mitigation:** intentionally separate — DONE must persist even if eval fails. Document in code comment.
