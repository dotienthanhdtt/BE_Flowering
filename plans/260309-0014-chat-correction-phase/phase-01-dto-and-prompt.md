# Phase 01: DTO & Prompt Template

## Context
- [plan.md](./plan.md)
- [brainstorm report](../reports/brainstorm-260309-0014-chat-correction-phase.md)
- Existing pattern: `src/modules/ai/dto/grammar-check.dto.ts`, `src/modules/ai/prompts/grammar-check-prompt.md`

## Overview
- **Priority**: High (blocks Phase 2)
- **Status**: complete
- **Description**: Create request/response DTOs and LLM prompt template for correction endpoint

## Requirements
- Request DTO with validation: previousAiMessage, userMessage, targetLanguage (all required strings)
- Response type: `{ correctedText: string | null }`
- Prompt template that instructs LLM to return ONLY corrected text or "null"

## Related Code Files

### Create
1. `src/modules/ai/dto/correction-check.dto.ts` — CorrectionCheckRequestDto, CorrectionCheckResponseDto
2. `src/modules/ai/prompts/correction-check-prompt.md` — prompt with {{previousAiMessage}}, {{userMessage}}, {{targetLanguage}}

### Modify
3. `src/modules/ai/dto/index.ts` — add export for new DTO file

## Implementation Steps

1. **Create `correction-check.dto.ts`**:
   ```typescript
   // CorrectionCheckRequestDto
   - previousAiMessage: string (@IsString, @MaxLength(4000))
   - userMessage: string (@IsString, @MaxLength(4000))
   - targetLanguage: string (@IsString, @MaxLength(50))
   // CorrectionCheckResponseDto
   - correctedText: string | null (@ApiPropertyOptional)
   ```

2. **Create `correction-check-prompt.md`**:
   - Context: previous AI message + user reply + target language
   - Task: check grammar, vocabulary, natural phrasing
   - Output: corrected text only (no JSON, no explanation) or literal word "null"
   - Rules: preserve meaning, only fix clear errors, don't over-correct casual speech

3. **Update `dto/index.ts`**: add `export * from './correction-check.dto'`

## Todo
- [x] Create correction-check.dto.ts with request/response classes
- [x] Create correction-check-prompt.md
- [x] Update dto/index.ts with new export

## Success Criteria
- DTOs compile without errors
- Prompt template loads via PromptLoaderService
- Swagger annotations present on DTO fields
