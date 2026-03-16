# Phase 4: Premium Guard + Decorator

**Priority:** High
**Status:** **COMPLETE**
**Depends on:** None (independent, but applied in Phase 5)
**Context:** [brainstorm](../reports/brainstorm-260314-1335-subscription-payment-features.md) § Priority 2

---

## Overview

Create `@RequirePremium()` decorator and `PremiumGuard` to restrict endpoints to paid subscribers.

## Key Insights

- Follows existing pattern: `@Public()` + `JwtAuthGuard` using `SetMetadata` + `Reflector`
- Guard needs `SubscriptionService` — requires `SubscriptionModule` export (already exports service)
- Must handle `@OptionalAuth()` endpoints: if user present → check premium; if no user → allow (onboarding)
- Wait — brainstorm says translate + correct require premium too. So: if user is authenticated, must be premium. If no auth, block.
- Actually, re-reading brainstorm: "Free endpoints: None in AI module. Translate + correct currently have @OptionalAuth but will require premium too"
- This means: remove `@OptionalAuth()` from translate/correct, make them require JWT + premium

## Related Code Files

**Create:**
- `src/common/decorators/require-premium.decorator.ts`
- `src/common/guards/premium.guard.ts`

**Modify:**
- `src/common/decorators/index.ts` — export new decorator (if index exists)
- `src/common/guards/index.ts` — export new guard (if index exists)

## Implementation Steps

1. Create `require-premium.decorator.ts`:
   ```typescript
   import { SetMetadata } from '@nestjs/common';

   export const REQUIRE_PREMIUM_KEY = 'require_premium';
   export const RequirePremium = () => SetMetadata(REQUIRE_PREMIUM_KEY, true);
   ```

2. Create `premium.guard.ts`:
   ```typescript
   @Injectable()
   export class PremiumGuard implements CanActivate {
     constructor(
       private reflector: Reflector,
       private subscriptionService: SubscriptionService,
     ) {}

     async canActivate(context: ExecutionContext): Promise<boolean> {
       const requirePremium = this.reflector.getAllAndOverride<boolean>(
         REQUIRE_PREMIUM_KEY,
         [context.getHandler(), context.getClass()],
       );

       if (!requirePremium) return true;

       const request = context.switchToHttp().getRequest();
       const user = request.user as User;

       if (!user) {
         throw new ForbiddenException('Authentication required for premium features');
       }

       const subscription = await this.subscriptionService.findByUserId(user.id);

       if (!subscription || subscription.plan === SubscriptionPlan.FREE || subscription.status !== SubscriptionStatus.ACTIVE) {
         throw new ForbiddenException('Premium subscription required');
       }

       return true;
     }
   }
   ```

3. Verify `SubscriptionService.findByUserId()` exists (used in GET /me endpoint — likely exists as `getSubscription()` or similar)

4. Run `npm run build`

## Todo

- [x] Create require-premium.decorator.ts
- [x] Create premium.guard.ts
- [x] Verify SubscriptionService has findByUserId method
- [x] Verify build passes

## Success Criteria

- Guard correctly reads `@RequirePremium()` metadata
- Returns 403 with clear message for free/expired users
- Passes for active paid subscribers
- No-ops when `@RequirePremium()` not present
- `npm run build` passes

## Security Considerations

- Guard runs AFTER `JwtAuthGuard` (global guard executes first)
- User object guaranteed present by JWT guard on protected routes
- Subscription check is real DB query, not cached — always fresh

## Risk Assessment

- **Low** — standard NestJS guard pattern, well-tested approach
- Must verify exact method name on SubscriptionService for fetching by userId
