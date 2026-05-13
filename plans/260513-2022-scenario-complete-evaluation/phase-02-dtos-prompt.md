---
phase: 2
title: "DTOs & Prompt"
status: completed
priority: P2
effort: "2h"
dependencies: [1]
---

# Phase 2: DTOs & Prompt

## Overview

Request/response DTOs for `/scenario/complete` + evaluator prompt JSON. Match existing scenario module DTO conventions (class-validator + Swagger decorators, snake_case in response per project API contract).

## Requirements

- Request DTO: `{ conversationId: string (uuid), scenarioId: string (uuid) }`
- Response DTO: extends scenario chat response shape + `evaluation` field (nullable on failure)
- Prompt: structured JSON output spec for LLM (overall/fluency/accuracy/vocab scores 0-100, strengths[], improvements[], summary, vocab_usage[])

## Related Code Files

- Create: `src/modules/scenario/dto/scenario-complete.dto.ts`
- Create: `src/modules/scenario/dto/scenario-evaluation.dto.ts`
- Create: `src/modules/ai/prompts/scenario-evaluation-prompt.json`

## Implementation Steps

1. `ScenarioCompleteRequestDto`: `@IsUUID() conversationId`, `@IsUUID() scenarioId` — mirror style of `ScenarioChatRequestDto` in `scenario-chat.dto.ts`.
2. `ScenarioEvaluationDto` (response sub-object):
   ```
   overall_score: number       // 0-100
   fluency_score: number
   accuracy_score: number
   vocab_score: number
   strengths: string[]
   improvements: string[]
   summary: string
   vocab_usage: Array<{ vocab_id: string; word: string; used: boolean }>
   ```
   Add `@ApiProperty` decorators per code-standards.
3. `ScenarioCompleteResponseDto`: reuse `scenario` + `messages` shape from `ScenarioChatResponseDto`. Add:
   ```
   evaluation: ScenarioEvaluationDto | null
   evaluation_error?: 'llm_unavailable' | 'parse_failed' | 'timeout' | 'invalid_response'
   ```
   **`evaluation_error` is a closed enum, NOT free-form `EvaluatorError.message`.** Raw LLM payload must never leak (CLAUDE.md "never expose raw exceptions"). Internal cause logged server-side only. _[Red Team #13]_

3b. **Response field whitelist for `evaluation` sub-object** — explicitly map ONLY these fields from `ScenarioEvaluation` entity:
   - `overall_score`, `fluency_score`, `accuracy_score`, `vocab_score`
   - `strengths`, `improvements`, `summary`, `vocab_usage`

   EXCLUDED from response (analytics-only): `model_used`, `prompt_version`, `created_at`, `id`, `user_id`, `scenario_id`, `conversation_id`. Phase 4 mapper must do explicit field selection — do NOT return raw entity. _[Red Team #12]_
4. Create `scenario-evaluation-prompt.json` modeled on existing `scenario-chat-prompt.json`. **Placeholder syntax: `{{varName}}` (double braces).** `PromptLoaderService.loadPrompt` at `src/modules/ai/services/prompt-loader.service.ts:65` only substitutes `{{...}}` — single braces pass through as literal text. Required placeholders: `{{targetLanguage}}`, `{{nativeLanguage}}`, `{{proficiencyLevel}}`, `{{scenarioTitle}}`, `{{scenarioDescription}}`, `{{transcript}}`, `{{injectedVocab}}`, `{{vocabUsageHits}}`. _[Red Team #1 — CRITICAL]_
5. Prompt requires strict JSON output (no prose). Define schema in prompt body. Include "respond ONLY with valid JSON matching this schema" instruction. Include version tag in prompt: `prompt_version=1`.

## Prompt Output Contract (parser must enforce)

```json
{
  "overall_score": 0,
  "fluency_score": 0,
  "accuracy_score": 0,
  "vocab_score": 0,
  "strengths": ["..."],
  "improvements": ["..."],
  "summary": "...",
  "vocab_usage": [{"vocab_id":"uuid","word":"...","used":true}]
}
```

All scores clamped to 0-100. Arrays may be empty.

## Success Criteria

- [ ] DTOs compile with class-validator decorators
- [ ] Swagger generates correct schema for `/scenario/complete`
- [ ] Prompt JSON loads via `PromptLoaderService` (string template interpolation)
- [ ] Sample LLM output validates against parser (test in phase 3)

## Risk Assessment

- **Risk:** LLM returns non-JSON or malformed JSON.
  **Mitigation:** parser in Phase 3 handles via try/catch + fallback to `evaluation: null + evaluation_error`.
- **Risk:** Drift between `ScenarioEvaluation` entity columns and DTO/response shape.
  **Mitigation:** entity-to-DTO mapper in Phase 4 service; keep field names aligned.
