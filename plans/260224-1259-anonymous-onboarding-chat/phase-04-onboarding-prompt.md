# Phase 04: Onboarding AI Prompt

## Context Links
- [Parent Plan](./plan.md)
- [Phase 03 (uses these prompts)](./phase-03-onboarding-service-and-controller.md)
- [Existing Tutor Prompt](../../src/modules/ai/prompts/tutor-system-prompt.md)
- [PromptLoaderService](../../src/modules/ai/services/prompt-loader.service.ts)

## Overview
- **Priority:** P1
- **Status:** complete
- **Effort:** 0.5h
- **Description:** Create two AI prompt templates: (1) onboarding chat system prompt for natural data collection, (2) extraction prompt for structured JSON output from conversation transcript.

## Key Insights
- PromptLoaderService uses `{{variable}}` syntax for substitution
- Prompts stored in `src/modules/ai/prompts/` as `.md` files
- Chat prompt needs turn-awareness (current turn, max turns, is last turn)
- Extraction prompt should output specific JSON schema
- Prompt should instruct AI to use the user's native language

## Requirements

### Functional
- Chat prompt: friendly onboarding persona, collects name/age/region/motivation naturally
- Chat prompt: adapts behavior based on turn number (early = open, mid = probe, late = summarize)
- Extraction prompt: takes conversation transcript, outputs structured JSON
- Both support `{{variable}}` substitution

### Non-Functional
- Prompts under 100 lines each
- Clear, unambiguous instructions to LLM

## Related Code Files

### Files to Create
- `src/modules/ai/prompts/onboarding-chat-prompt.md`
- `src/modules/ai/prompts/onboarding-extraction-prompt.md`

## Implementation Steps

### Step 1: Create Chat System Prompt

File: `src/modules/ai/prompts/onboarding-chat-prompt.md`

```markdown
You are a friendly language learning assistant helping a new user get started. Your goal is to have a natural, warm conversation to learn about them while making them excited about learning {{targetLanguage}}.

## Your Objectives
Naturally collect these details through conversation (do NOT ask all at once):
1. **Name** - How they'd like to be called
2. **Age** or age range
3. **Region/Country** - Where they're from or live
4. **Learning motivation** - Why they want to learn {{targetLanguage}}

## Conversation Rules
- Respond in {{nativeLanguage}} (the user's native language)
- Keep responses concise (2-4 sentences max)
- Be warm, encouraging, and conversational
- Ask ONE question at a time
- Acknowledge what the user shares before asking the next question
- Sprinkle in a few words of {{targetLanguage}} to build excitement
- Current turn: {{currentTurn}} of {{maxTurns}}

## Turn Guidance
- Turns 1-3: Greet warmly, ask name, start getting to know them
- Turns 4-6: Learn about their background (age, region)
- Turns 7-9: Understand their motivation and goals
- Turn 10 (final): Summarize what you've learned, express excitement about their journey

{{#isLastTurn}}
## Final Turn Instructions
This is the last turn. Warmly summarize everything you've learned about the user (name, background, motivation). Express genuine excitement about helping them learn {{targetLanguage}}. End with an encouraging message.
{{/isLastTurn}}
```

**Note on `{{#isLastTurn}}`:** The PromptLoaderService does simple string replacement. For the `isLastTurn` conditional, the service should substitute `{{isLastTurn}}` with `'true'` or `'false'`. The prompt includes both sections; the LLM can interpret context. Alternatively, implement in the service by appending the final-turn block when `isLastTurn === 'true'`.

**Simpler approach (recommended):** Instead of template conditionals, the service appends the final-turn block programmatically:

```typescript
let systemPrompt = this.promptLoader.loadPrompt('onboarding-chat-prompt', { ... });
if (isLastTurn) {
  systemPrompt += '\n\nIMPORTANT: This is the FINAL turn. Summarize everything you learned about the user.';
}
```

### Step 2: Create Extraction Prompt

File: `src/modules/ai/prompts/onboarding-extraction-prompt.md`

```markdown
Extract structured user profile data from the following onboarding conversation transcript. Return ONLY a JSON object, no other text.

## Conversation Transcript
{{transcript}}

## Required JSON Schema
```json
{
  "name": "string or null",
  "age": "number or null",
  "region": "string or null (country or region name)",
  "learningMotivation": "string or null (brief summary)",
  "suggestedProficiency": "beginner | intermediate | advanced (infer from conversation)"
}
```

## Rules
- Extract ONLY information explicitly stated or clearly implied by the user
- Use null for any field not mentioned in the conversation
- For age, extract a number if possible (e.g., "I'm in my 20s" -> 25)
- For suggestedProficiency, default to "beginner" if unclear
- For learningMotivation, provide a brief 1-sentence summary
- Return valid JSON only, wrapped in ```json``` code block
```

## Todo List
- [ ] Create `onboarding-chat-prompt.md`
- [ ] Create `onboarding-extraction-prompt.md`
- [ ] Update OnboardingService to handle `isLastTurn` prompt appending
- [ ] Test prompt loading via PromptLoaderService
- [ ] Verify variable substitution works correctly

## Success Criteria
- Both prompts load via `PromptLoaderService.loadPrompt()` without errors
- Chat prompt produces natural, friendly responses in native language
- Extraction prompt returns valid JSON with all 5 fields
- Variables substitute correctly

## Risk Assessment
- **Medium:** LLM may not consistently output valid JSON from extraction. Mitigated by fallback parsing in service.
- **Low:** The `{{#isLastTurn}}` conditional syntax not supported natively. Use programmatic appending instead.
- **Low:** Prompt may need iterative tuning after testing with real conversations

## Security Considerations
- No sensitive data in prompts
- User input injected via `{{transcript}}` -- LLM should be instructed to extract, not execute

## Next Steps
- Phase 05: Auth Linking (independent of this phase)
- Iterative prompt tuning based on test results
