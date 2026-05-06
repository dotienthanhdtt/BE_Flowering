# Phase 03 — Controller Wiring + Swagger + Remove `/start`

## Context Links

- Plan overview: `plan.md`
- Blockers: phase 01 (`handleChat`), phase 02 (`OnboardingThrottlerGuard`)
- Current controller: `src/modules/onboarding/onboarding.controller.ts`

## Overview

- **Priority:** P1
- **Status:** completed
- **Brief:** Delete `start()` method. Rewrite `chat()` to call `onboardingService.handleChat`. Swap `ThrottlerGuard` + `@Throttle` for `OnboardingThrottlerGuard`. Update Swagger examples.

## Key Insights

- `complete()` endpoint untouched.
- Response wrapping handled by global `ResponseTransformInterceptor`; return plain object from service.
- `@Public()` decorator stays (bypasses global JWT guard).

## Requirements

**Functional**
- `POST /onboarding/chat` handles both branches.
- `POST /onboarding/start` returns 404 (route removed).
- Swagger reflects new contract: optional fields, unified response shape.

**Non-functional**
- Controller file <80 lines.

## Architecture

```
@Controller('onboarding')
@UseGuards(OnboardingThrottlerGuard)
export class OnboardingController {
  @Public() @Post('chat') @HttpCode(200)
  chat(@Body() dto: OnboardingChatDto) → service.handleChat(dto)

  @Public() @Post('complete') @HttpCode(200)
  complete(@Body() dto: OnboardingCompleteDto) → service.complete(dto)
}
```

## Related Code Files

**Modify**
- `src/modules/onboarding/onboarding.controller.ts`
- `src/modules/onboarding/onboarding.module.ts` — register `OnboardingThrottlerGuard` if needed as provider

**Read**
- `src/modules/onboarding/onboarding.service.ts` (confirm `handleChat` signature)

## Implementation Steps

1. Edit controller:
   - Remove `StartOnboardingDto` import.
   - Swap `@UseGuards(ThrottlerGuard)` → `@UseGuards(OnboardingThrottlerGuard)`.
   - Remove class-level `@Throttle(...)` (guard handles it).
   - Delete `start()` method entirely.
   - `chat()` body: `return this.onboardingService.handleChat(dto);`
   - Update `@ApiOperation` summary: "Start or continue onboarding chat".
   - Add Swagger examples for both branches via `@ApiBody` with multiple `examples` entries.
2. Edit `onboarding.module.ts`: add `OnboardingThrottlerGuard` to providers (it's a guard but class-based subclass — must be DI-registered).
3. `npm run build`.
4. Manual smoke: `curl -X POST /onboarding/chat -d '{"nativeLanguage":"vi","targetLanguage":"en"}'` → 200 + greeting.

## Todo List

- [ ] Remove `start()` method
- [ ] Swap guard decorator
- [ ] Remove class-level `@Throttle`
- [ ] Rewrite `chat()` to call `handleChat`
- [ ] Update Swagger annotations with dual examples
- [ ] Register guard in module providers
- [ ] `npm run build` passes
- [ ] Manual curl smoke test

## Success Criteria

- `POST /onboarding/start` → 404.
- `POST /onboarding/chat` works both branches.
- Swagger UI shows one endpoint with two example payloads.
- Response envelope: `{code: 1, message, data: {conversationId, reply, messageId, turnNumber, isLastTurn}}`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Flutter still calls `/start` post-deploy | High | High | Coordinate release with mobile; phase 05 must ship before backend cut |
| Guard not registered as provider → Nest DI error | Medium | High | Register in module; build catches missing provider only at runtime, so smoke test |
| Swagger example mismatch | Low | Low | Test `/api/docs` after deploy |

## Security Considerations

- `@Public()` remains — confirm no sensitive data leaks via greeting prompt.
- Throttler is sole abuse guard — don't remove or weaken.

## Next Steps

- Phase 04 validates with tests.
- Phase 05 updates Flutter.
- Phase 06 updates docs.
