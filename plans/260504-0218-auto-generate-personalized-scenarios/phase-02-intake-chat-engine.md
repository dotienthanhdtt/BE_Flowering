# Phase 02 — Extract IntakeChatEngine

## Context Links
- Brainstorm §3, §4 (Approach B), §5.2
- Source: `src/modules/onboarding/onboarding.service.ts` (359 lines)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Refactor onboarding chat/extract loop into reusable `IntakeChatEngine` consumed by both onboarding (anonymous) and personalization (authed). Pure refactor — no behavior change for onboarding.

## Key Insights
- Onboarding has tested chat → extraction → generation flow. Extract the generic part; onboarding becomes a thin wrapper.
- Engine must NOT assume anonymous (no `sessionId` baked in); takes `conversationId` (string) abstractly.
- `onComplete` callback returns `T` — onboarding returns `OnboardingScenarioDto[]`, personalization returns `Scenario[]`. Generic.

## Requirements
**Functional:**
- Engine exposes: `startTurn(ctx)`, `processTurn(ctx, message)`, `complete(ctx)` returning `{profile, generated: T}`.
- Takes config: `{promptKey, extractionPromptKey, scenariosPromptKey, maxTurns, conversationType, langfuseFeature}`.
- Takes `onComplete(profile, conversationId, ctx) => Promise<T>` for output persistence.
- All LLM calls flow through `UnifiedLLMService` with Langfuse trace + feature tag.

**Non-Functional:**
- Onboarding e2e + unit tests pass unchanged.
- No new public API exposed by onboarding.

## Architecture
```
IntakeChatEngine (new, in src/modules/ai/)
  ├── deps: UnifiedLLMService, PromptLoaderService, LangfuseTracingService, AiConversationRepo
  └── methods: startTurn, processTurn, extractProfile, completeAndGenerate

OnboardingService (refactored)
  └── delegates to IntakeChatEngine; supplies anonymous-specific glue (sessionId, in-memory state)

PersonalizationService (Phase 03)
  └── delegates to IntakeChatEngine; supplies userId + DB persistence
```

## Related Code Files
**Modify:**
- `src/modules/onboarding/onboarding.service.ts` — strip generic logic, delegate
- `src/modules/onboarding/onboarding.module.ts` — import AI module if engine lives there
- `src/modules/ai/ai.module.ts` — export `IntakeChatEngine`

**Create:**
- `src/modules/ai/services/intake-chat-engine.service.ts`
- `src/modules/ai/services/intake-chat-engine.types.ts` (config + ctx interfaces)

**Delete:** none

## Implementation Steps
1. Map current `OnboardingService` methods → categorize generic vs onboarding-specific.
2. Define `IntakeChatEngineConfig` and `IntakeContext` types.
3. Create `intake-chat-engine.service.ts`: methods `runTurn(ctx, message)`, `extractProfile(ctx)`, `generateOutputs(ctx, profile)`.
4. Move prompt-loading, LLM dispatch, message persistence, Langfuse trace into engine.
5. Refactor `OnboardingService.chat()` → call `engine.runTurn` with onboarding config.
6. Refactor `OnboardingService.complete()` → call `engine.extractProfile` then `onComplete` callback that generates anonymous scenarios.
7. Run `npm test -- onboarding` — all green required.
8. Run `npm run build`.

## Todo List
- [ ] Define engine types
- [ ] Implement IntakeChatEngine
- [ ] Refactor OnboardingService to thin wrapper
- [ ] Update OnboardingModule wiring
- [ ] Onboarding tests pass
- [ ] Build clean

## Success Criteria
- Onboarding test suite 100% pass (no behavior change).
- `OnboardingService` reduced to <150 lines.
- `IntakeChatEngine` ≤200 lines (split if over).
- New engine has injectable deps + zero onboarding-specific imports.

## Risk Assessment
- **Hidden onboarding state coupling** → run e2e + manual smoke before merge.
- **Prompt-key naming collision** → engine takes keys as config, no hardcoded onboarding strings.
- **Langfuse trace continuity** → trace ID propagation must survive refactor; verify in dev.

## Security Considerations
- Engine handles user-provided text → ensure prompt injection mitigation already in onboarding (system prompt boundaries) is preserved verbatim.

## Next Steps
- Unblocks Phase 03 (PersonalizationService consumes engine).
