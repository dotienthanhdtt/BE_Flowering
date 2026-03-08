# Brainstorm: Chat Correction Phase

## Problem Statement
When user replies to AI in chat, app needs an API to check grammar/vocabulary of user's message in context of previous AI message. Returns corrected version if errors found, null if correct.

## Evaluated Approaches

### A. New Dedicated Endpoint ✅ CHOSEN
- `POST /ai/chat/correct` — separate from chat and grammar/check
- **Pros**: clean separation, can run parallel with chat, simple contract
- **Cons**: one more endpoint to maintain

### B. Extend Existing Grammar Check
- Add `previousAiMessage` to `POST /ai/grammar/check`
- **Pros**: reuses existing endpoint
- **Cons**: muddies the grammar check API, different response shape needed (null vs detailed errors)

### C. Inline in Chat Response
- Return correction data alongside AI reply in `POST /ai/chat`
- **Pros**: single call
- **Cons**: couples correction with chat, can't parallelize, slower chat response, complex response shape

## Final Recommended Solution

### Endpoint
```
POST /ai/chat/correct
```

### Auth
`@OptionalAuth()` — works for both authenticated users and anonymous onboarding. Rate limited by userId (auth) or IP (anon).

### Request DTO
```typescript
{
  previousAiMessage: string;  // max 4000 chars
  userMessage: string;        // max 4000 chars
  targetLanguage: string;     // language being learned
}
```

### Response
```typescript
{
  correctedText: string | null;  // null = correct, string = corrected version
}
```

### Model
GPT-4.1 Nano — fast (~200-500ms), cheap, sufficient for grammar/vocab correction.

### Prompt Strategy
Simple template (`correction-check-prompt.md`):
- 3 variables: previousAiMessage, userMessage, targetLanguage
- Check grammar, vocabulary, natural phrasing in context
- Return ONLY corrected text or the word "null"
- No explanations, no JSON wrapping
- Preserve meaning, only fix errors
- Don't correct informal/casual speech that's intentional

### Files to Create/Modify
1. `src/modules/ai/dto/correction-check.dto.ts` — request/response DTOs
2. `src/modules/ai/prompts/correction-check-prompt.md` — LLM prompt
3. `src/modules/ai/learning-agent.service.ts` — add `checkCorrection()` method
4. `src/modules/ai/ai.controller.ts` — add endpoint
5. Test file for correction feature

## Risk Assessment
| Risk | Mitigation |
|---|---|
| LLM false positives (over-correcting casual speech) | Prompt instructs to only flag clear errors |
| LLM returns "null" as string | Service layer trims + checks for literal "null" string |
| Rate abuse on public-ish endpoint | @OptionalAuth + ThrottlerGuard (20 req/min) |
| Slow response blocking UX | GPT-4.1 Nano is fast; app calls parallel with chat |

## Success Criteria
- Endpoint returns corrected text when grammar/vocab errors exist
- Returns null when message is correct
- Response time < 1s for typical messages
- Works for both auth and anon users
- Rate limited appropriately
