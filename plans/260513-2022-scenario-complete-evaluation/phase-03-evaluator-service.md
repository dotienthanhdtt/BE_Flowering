---
phase: 3
title: "Evaluator Service"
status: completed
priority: P2
effort: "3h"
dependencies: [2]
---

# Phase 3: Evaluator Service

## Overview

`ScenarioEvaluatorService` builds the prompt, calls LLM (9router → Gemini fallback), parses + validates JSON output, returns a typed `ScenarioEvaluationResult`. No DB writes here — pure compute.

## Requirements

- Input: scenario meta, transcript messages, injected vocab, vocab usage events, language context
- Output: parsed `ScenarioEvaluationResult` OR throws `EvaluatorError` (caught by caller)
- Reuse `UnifiedLLMService`, `PromptLoaderService`, `invokeLlmWithFallback` pattern from `ScenarioChatService`
- Langfuse tracing: new `LangfuseFeature.SCENARIO_EVALUATION` enum entry

## Architecture

```
class ScenarioEvaluatorService {
  evaluate(input: EvaluatorInput): Promise<ScenarioEvaluationResult>
  
  private buildPrompt(input): string         // PromptLoaderService
  private invokeLlmWithFallback(...): string // mirror chat service
  private parseAndValidate(raw): result      // JSON.parse + zod-like clamp
}
```

## Related Code Files

- Create: `src/modules/scenario/services/scenario-evaluator.service.ts`
- Create: `src/modules/scenario/services/scenario-evaluator.service.spec.ts` (unit tests live here)
- Modify: `src/modules/ai/langfuse-feature.enum.ts` (add `SCENARIO_EVALUATION`)

## Implementation Steps

1. Define `EvaluatorInput` type: `{ scenario, transcript, injectedVocab, vocabUsageHits, langCtx, userId, conversationId }`.
2. Define `ScenarioEvaluationResult` type matching DTO from Phase 2 + `modelUsed`, `promptVersion`.
3. Build prompt via `promptLoader.loadPrompt('scenario-evaluation-prompt.json', { ... })`. Format transcript as `"User: ...\nAssistant: ...\n"`. Format vocab usage hits compactly.
   - **All placeholders must use `{{varName}}` (double-brace) — see Phase 2 step 4.** _[Red Team #1]_
   - **Vocab-usage fallback:** if `vocabUsageHits.length === 0 && injectedVocab.length > 0` (legacy conversations created before `VocabularyInjectionEvent` writes existed, OR conversations where vocab injection failed but words were still shown), re-compute hits from full transcript text via `matchesWord` from `services/vocabulary-usage-matcher.ts`. This avoids `vocab_score=0` false negatives. _[Red Team #6]_
4. LLM call: copy `invokeLlmWithFallback` from chat service (DRY temptation — extract to shared util later if a third caller appears; YAGNI for now, duplicate the 15 lines).
   - **Wrap call in 15s timeout** via `Promise.race([llmCall, timeoutPromise])`. On timeout → throw `EvaluatorError('timeout')` so caller maps to `evaluation_error: 'timeout'`. Without this, sync `/complete` hangs the mobile client when 9router degrades and Gemini fallback is slow. _[Red Team #14]_
5. Parser:
   - `JSON.parse(raw)` — wrap in try/catch
   - Validate required fields present
   - Clamp scores to [0, 100]
   - Default empty arrays for `strengths`, `improvements`, `vocab_usage`
   - Throw `EvaluatorError('parse_failed')` — error code only, log raw payload via Logger.warn server-side. **Do NOT pass `raw` into the constructor message** (would surface to client via `evaluation_error`). _[Red Team #13]_
6. Return `ScenarioEvaluationResult` with `modelUsed` (track which model produced it for analytics).
7. Add `SCENARIO_EVALUATION` to `LangfuseFeature` enum.
8. Pass `feature: LangfuseFeature.SCENARIO_EVALUATION` in metadata for tracing.

## Success Criteria

- [ ] Service compiles, no circular deps
- [ ] Unit test: valid JSON → parsed result
- [ ] Unit test: malformed JSON → throws `EvaluatorError`
- [ ] Unit test: out-of-range scores get clamped
- [ ] Unit test: fallback triggers on `ServiceUnavailableException`
- [ ] Langfuse traces appear with feature tag

## Risk Assessment

- **Risk:** LLM wraps JSON in markdown fences (```json ... ```).
  **Mitigation:** parser strips common wrappers before `JSON.parse`.
- **Risk:** Duplication of `invokeLlmWithFallback` across chat + evaluator.
  **Mitigation:** accepted — extract to shared util only when a 3rd caller appears (YAGNI). Note duplication in code comment.
