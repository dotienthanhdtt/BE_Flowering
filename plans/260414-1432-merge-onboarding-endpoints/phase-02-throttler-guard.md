# Phase 02 — Custom Throttler Guard

## Context Links

- Plan overview: `plan.md`
- Existing throttle decorators: `src/modules/onboarding/onboarding.controller.ts:10-11,16`
- Nest throttler docs: `@nestjs/throttler` `ThrottlerGuard#getTracker`, `handleRequest`

## Overview

- **Priority:** P1 (required before controller change)
- **Status:** completed
- **Brief:** Single guard, two limits: 5/hr when `!body.conversationId`, 30/hr otherwise. Replace per-method `@Throttle` decorators.

## Key Insights

- Nest's built-in `ThrottlerGuard` reads limits from metadata at class/method level. For body-conditional limits, subclass and override `handleRequest` (or use separate named throttlers via `throttlers` config + conditional decorator).
- Simpler: subclass once, inspect `req.body.conversationId`, call `super.handleRequest` with chosen `limit`/`ttl`.
- Tracking key should be IP (default) for creation branch; per-`conversationId` optional but IP is enough + simpler.

## Requirements

**Functional**
- Guard returns `true` within limit; throws `ThrottlerException` (429) on breach.
- Creation branch: 5 requests/hour per IP.
- Chat branch: 30 requests/hour per IP.

**Non-functional**
- Single file, <100 lines.
- No global config change needed.

## Architecture

```
Request → OnboardingThrottlerGuard.handleRequest
          ├─ body.conversationId? → limit=30, ttl=3_600_000
          └─ else                 → limit=5,  ttl=3_600_000
          → super.handleRequest(ctx, limit, ttl, ...)
```

## Related Code Files

**Create**
- `src/modules/onboarding/onboarding-throttler.guard.ts`

**Modify (in phase 03)**
- `src/modules/onboarding/onboarding.controller.ts` — swap `ThrottlerGuard` + `@Throttle` for new guard

## Implementation Steps

1. Create `onboarding-throttler.guard.ts`:
   ```ts
   import { Injectable, ExecutionContext } from '@nestjs/common';
   import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

   @Injectable()
   export class OnboardingThrottlerGuard extends ThrottlerGuard {
     protected async handleRequest(req: ThrottlerRequest): Promise<boolean> {
       const httpReq = req.context.switchToHttp().getRequest();
       const hasConv = !!httpReq.body?.conversationId;
       return super.handleRequest({
         ...req,
         limit: hasConv ? 30 : 5,
         ttl: 3_600_000,
       });
     }
   }
   ```
2. Verify `@nestjs/throttler` version exports `ThrottlerRequest` shape (v6+). If on older version, override `handleRequest(context, limit, ttl, throttler)` classic signature.
3. Compile (`npm run build`).

## Todo List

- [ ] Create `onboarding-throttler.guard.ts`
- [ ] Verify throttler API signature matches installed version (check `package.json`)
- [ ] `npm run build` passes

## Success Criteria

- Guard file compiles.
- Used in phase 03; manual hammer test returns 429 after 5 creation attempts within hour.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Throttler API signature drift | Medium | Medium | Check installed version, adapt override |
| IP spoofing via `X-Forwarded-For` behind proxy | Medium | Medium | Confirm `trustProxy` set in `main.ts`; else IP parsing wrong |
| Shared IP (NAT, cafe) hits 5/hr quickly | Low | Low | Document; acceptable tradeoff for abuse guard |

## Security Considerations

- Creation branch limit is the abuse wall — don't raise without reason.
- Log breaches at `warn` for ops visibility.
- No auth — IP is only identifier. Consider per-`conversationId` tracking in future phase if IP proves too coarse.

## Next Steps

Phase 03 wires guard in controller.
