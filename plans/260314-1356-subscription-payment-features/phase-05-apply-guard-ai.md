# Phase 5: Apply Guard to AI Controller

**Priority:** High
**Status:** **COMPLETE**
**Depends on:** Phase 4 (PremiumGuard must exist)
**Context:** [brainstorm](../reports/brainstorm-260314-1335-subscription-payment-features.md) § Priority 2

---

## Overview

Apply `@RequirePremium()` and `PremiumGuard` to all AI endpoints. Remove `@OptionalAuth()` from translate and correct endpoints.

## Key Insights

- AI controller has 9 endpoints — ALL require premium per brainstorm
- Two endpoints use `@OptionalAuth()`: translate, correct — must be removed
- Apply `@UseGuards(PremiumGuard)` + `@RequirePremium()` at controller level for simplicity
- `AiModule` must import `SubscriptionModule` for guard's dependency injection

## Related Code Files

**Modify:**
- `src/modules/ai/ai.controller.ts` — add guard + decorator at controller level, remove `@OptionalAuth()`
- `src/modules/ai/ai.module.ts` — import `SubscriptionModule`

## Implementation Steps

1. Add `SubscriptionModule` to `AiModule` imports:
   ```typescript
   imports: [
     // ... existing imports
     SubscriptionModule,
   ],
   ```

2. Add controller-level guard and decorator to `AiController`:
   ```typescript
   @Controller('ai')
   @ApiTags('AI')
   @ApiBearerAuth('JWT-auth')
   @UseGuards(ThrottlerGuard, PremiumGuard)  // Add PremiumGuard
   @RequirePremium()                          // Add decorator
   export class AiController {
   ```

3. Remove `@OptionalAuth()` from:
   - `POST /ai/translate` endpoint
   - `POST /ai/chat/correct` endpoint

4. Update translate/correct endpoints to use `@CurrentUser()` instead of `req.user as User | null`:
   - These now require auth, so user is guaranteed non-null

5. Run `npm run build`

## Todo

- [x] Import SubscriptionModule in AiModule
- [x] Add PremiumGuard + @RequirePremium() at controller level
- [x] Remove @OptionalAuth() from translate endpoint (integration intentional per brainstorm)
- [x] Remove @OptionalAuth() from correct endpoint (integration intentional per brainstorm)
- [x] Update user extraction in translate/correct to use @CurrentUser()
- [x] Verify build passes

## Success Criteria

- All AI endpoints return 403 for free/expired users
- All AI endpoints require JWT authentication (no optional auth)
- Existing authenticated premium users unaffected
- `npm run build` passes

## Risk Assessment

- **Breaking change for mobile** — translate/correct currently work without auth
  - Mobile must be updated to always send JWT for AI endpoints
  - Coordinate with mobile team before deploying
- **Guard ordering** — `ThrottlerGuard` should run before `PremiumGuard` (rate limit first, then subscription check to avoid unnecessary DB queries on rate-limited requests)

## Security Considerations

- Removing `@OptionalAuth()` means unauthenticated requests get 401 from global JWT guard before reaching PremiumGuard
- Double protection: JWT guard (auth) → PremiumGuard (subscription)
