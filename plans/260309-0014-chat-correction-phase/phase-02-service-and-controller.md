# Phase 02: Service & Controller

## Context
- [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-dto-and-prompt.md)
- Service pattern: `src/modules/ai/services/learning-agent.service.ts` line 139-159 (checkGrammar)
- Controller pattern: `src/modules/ai/ai.controller.ts` line 160-184 (translate with @OptionalAuth)

## Overview
- **Priority**: High
- **Status**: complete
- **Description**: Add checkCorrection() method to LearningAgentService and POST /ai/chat/correct endpoint to AiController

## Requirements
- Service method loads prompt, calls LLM, parses response (corrected text or null)
- Controller endpoint with @OptionalAuth(), Swagger docs, ThrottlerGuard (already applied at class level)
- Model: GPT-4.1 Nano, temperature: 0.3

## Related Code Files

### Modify
1. `src/modules/ai/services/learning-agent.service.ts` — add `checkCorrection()` method
2. `src/modules/ai/ai.controller.ts` — add `POST /ai/chat/correct` endpoint

## Implementation Steps

1. **Add `checkCorrection()` to LearningAgentService**:
   ```typescript
   async checkCorrection(
     previousAiMessage: string,
     userMessage: string,
     targetLanguage: string,
   ): Promise<{ correctedText: string | null }> {
     const prompt = this.promptLoader.loadPrompt('correction-check-prompt', {
       previousAiMessage,
       userMessage,
       targetLanguage,
     });
     const response = await this.llmService.chat(
       [new HumanMessage(prompt)],
       { model: LLMModel.OPENAI_GPT4_1_NANO, temperature: 0.3, metadata: { feature: 'correction-check' } },
     );
     const trimmed = response.trim().replace(/^["']|["']$/g, '');
     const correctedText = trimmed.toLowerCase() === 'null' ? null : trimmed;
     return { correctedText };
   }
   ```

2. **Add endpoint to AiController** (place after grammar/check, before exercises):
   ```typescript
   @Post('chat/correct')
   @OptionalAuth()
   @ApiOperation({ summary: 'Check grammar/vocabulary of user chat reply' })
   @ApiResponse({ status: 200, type: CorrectionCheckResponseDto })
   async checkCorrection(@Body() dto: CorrectionCheckRequestDto): Promise<CorrectionCheckResponseDto> {
     return this.learningAgent.checkCorrection(
       dto.previousAiMessage, dto.userMessage, dto.targetLanguage,
     );
   }
   ```

3. **Update imports** in both files for new DTO types

## Todo
- [x] Add checkCorrection() method to LearningAgentService
- [x] Add POST /ai/chat/correct endpoint to AiController
- [x] Update imports in both files
- [x] Run `npm run build` to verify compilation

## Success Criteria
- Endpoint accessible at POST /ai/chat/correct
- Works without JWT (returns correction or null)
- Works with JWT (same behavior)
- Shows in Swagger docs
- Build passes without errors
