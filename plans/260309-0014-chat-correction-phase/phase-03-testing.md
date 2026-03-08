# Phase 03: Testing

## Context
- [plan.md](./plan.md)
- Depends on: [Phase 02](./phase-02-service-and-controller.md)
- Test pattern: `npm test` (Jest)

## Overview
- **Priority**: Medium
- **Status**: complete
- **Description**: Unit tests for checkCorrection() service method and controller endpoint

## Requirements
- Test service method: correct input returns null, incorrect input returns corrected text
- Test LLM response parsing: handles "null", quoted strings, whitespace
- Test controller endpoint routing and DTO validation

## Related Code Files

### Create
1. `src/modules/ai/services/learning-agent-correction.service.spec.ts` — focused test file for correction feature

## Implementation Steps

1. **Test cases for `checkCorrection()`**:
   - Returns `{ correctedText: null }` when LLM returns "null"
   - Returns `{ correctedText: "corrected sentence" }` when LLM returns corrected text
   - Handles LLM returning "null" with whitespace/quotes
   - Handles empty string from LLM gracefully
   - Verifies correct prompt template and model are used

2. **Mock setup**:
   - Mock `UnifiedLLMService.chat()` to return test responses
   - Mock `PromptLoaderService.loadPrompt()` to verify template variables
   - No DB mocks needed (stateless endpoint)

## Todo
- [x] Create test file with service method tests
- [x] Run `npm test` and verify all pass (97 tests passing)

## Success Criteria
- All tests pass
- Covers null response, corrected response, edge cases
- `npm test` exits cleanly
