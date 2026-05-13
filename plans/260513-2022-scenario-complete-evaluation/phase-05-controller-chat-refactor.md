---
phase: 5
title: "Controller & Chat Refactor"
status: completed
priority: P1
effort: "2h"
dependencies: [4]
---

# Phase 5: Controller & Chat Refactor

## Overview

Wire `POST /scenario/complete` to the new service. **Keep dual-fire** of `personalizationTrigger.maybeTrigger()` during transition: both chat-induced DONE and `/complete` call it. Trigger has internal advisory lock (`personalization-trigger.service.ts:35`) which makes dual-fire idempotent. Remove from chat path only AFTER mobile client integration confirmed in production. _[Red Team #3 — CRITICAL]_

Also: chat-path DONE flip must set `completedAt` (cross-phase note in Phase 1). _[Red Team #5]_

## Requirements

- Endpoint: `POST /scenario/complete` on existing `ScenarioChatController` (no new controller needed — same resource family)
- Guards: `JwtAuth` (global), `ResourceAccessGuard` + `@RequireResourceAccess({ resource: 'scenario', bodyKey: 'scenarioId' })` — mirrors `/scenario/chat`
- Throttle: dedicated bucket `scenario-complete: 30/min` (NOT shared with chat's `ai-short`). Register in `scenario-chat.module.ts` throttler config. _[Red Team #15]_
- Header: `X-Learning-Language` required (via `@ActiveLanguage()`)

## Related Code Files

- Modify: `src/modules/scenario/scenario-chat.controller.ts` (add `@Post('complete')` handler)
- Modify: `src/modules/scenario/scenario-chat.module.ts` (register `ScenarioCompleteService`, `ScenarioEvaluatorService`, `ScenarioEvaluation` entity in `forFeature`)
- Modify: `src/modules/scenario/services/scenario-chat.service.ts` (REMOVE personalization trigger block at lines 228-236; remove `PersonalizationTriggerService` from constructor injection if unused elsewhere)

## Implementation Steps

1. Add handler to `ScenarioChatController`:
   ```ts
   @Post('complete')
   @Throttle({ 'scenario-complete': { limit: 30, ttl: 60_000 } })
   @UseGuards(ResourceAccessGuard)
   @RequireResourceAccess({ resource: 'scenario', bodyKey: 'scenarioId' })
   @ApiOperation({ summary: 'Mark scenario conversation as complete and return evaluation' })
   @ApiResponse({ status: 200, type: ScenarioCompleteResponseDto })
   async complete(
     @Req() req: AuthenticatedRequest,
     @ActiveLanguage() lang: ActiveLanguageContext,
     @Body() dto: ScenarioCompleteRequestDto,
   ): Promise<ScenarioCompleteResponseDto> {
     return this.completeService.complete(req.user!.id, dto, lang.id);
   }
   ```
2. Inject `ScenarioCompleteService` into controller constructor.
3. Update `scenario-chat.module.ts`:
   - Add `ScenarioEvaluation` to `TypeOrmModule.forFeature([...])`
   - Add `ScenarioCompleteService`, `ScenarioEvaluatorService` to providers
   - Add `ScenarioConversationHelpersService` (if extracted in Phase 4) to providers
   - Ensure `PersonalizationModule` is imported (for `PersonalizationTriggerService`)
4. **KEEP** personalization trigger in `ScenarioChatService.chat()` (lines 228-236) for now. Dual-fire is safe — trigger's internal advisory lock at `personalization-trigger.service.ts:35` makes it idempotent per `(userId, scenarioId)` per transaction. Schedule chat-path removal as a follow-up PR once mobile clients have adopted `/complete`. _[Red Team #3]_
4b. **Add `completedAt = new Date()` to chat path DONE flip** at `scenario-chat.service.ts:218` — same line that flips status. Without this, `completed_at` column is ~always NULL. _[Red Team #5]_
5. Run `npm run build` → confirm clean compile.
6. Manual smoke: start dev, POST a scenario chat to DONE, then POST /complete → verify response shape.

## Success Criteria

- [ ] `POST /scenario/complete` returns 200 with full response shape
- [ ] Swagger doc shows endpoint under "Scenario Chat" tag with correct schema
- [ ] Chat service no longer references `PersonalizationTriggerService`
- [ ] Existing chat tests still pass after refactor
- [ ] Manual smoke flow: chat → /complete → see evaluation
- [ ] `npm run build` passes

## Risk Assessment

- **Risk:** Forgetting to update `scenario-chat.module.ts` causes runtime `Nest can't resolve dependencies` error.
  **Mitigation:** explicit module update step + boot test.
- **Risk:** Removing trigger from chat breaks downstream personalization flow for users who DON'T call /complete.
  **Mitigation:** documented in brainstorm — client contract must call /complete. v2 fallback (lazy eval on GET) tracked as future work.
- **Risk:** Throttle bucket collision with chat (`ai-short`).
  **Mitigation:** use a fresh limiter key or accept shared bucket (likely fine — same user won't spam both).
