# Phase 3 — Re-enable `ResourceAccessGuard`

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- File: `src/common/guards/resource-access.guard.ts`
- Decorator: `src/common/decorators/require-resource-access.decorator.ts`
- Tier cache: `src/common/services/access-tier-cache.service.ts`

## Overview
**Priority:** P0
**Status:** Pending
Restore tier-based premium enforcement. Currently `canActivate` returns `true` always.

## Key Insights
- Decorator metadata key: `REQUIRE_RESOURCE_ACCESS_KEY`, payload `{ resource, paramKey?, bodyKey? }`.
- `AccessTierCacheService.get(resource, id)` returns `AccessTier | null`. 5-min TTL, in-memory.
- `SubscriptionService.isUserPremium(userId)` already implemented (subscription.service.ts:557).
- All deps already injected in current guard constructor (just unused).

## Requirements
- Read decoration metadata; no decoration → allow (guard is opt-in).
- Resolve resource ID from `request.params[paramKey]` OR `request.body[bodyKey]`.
- Resource not found / tier null → 404 (or pass-through; pick consistent with team convention).
- Tier === FREE → allow.
- Tier === PREMIUM + user not premium → 403 with clear message.
- Unauthenticated request on premium route → 403, not 500.

## Architecture
```
canActivate(ctx):
  meta = reflector.get(REQUIRE_RESOURCE_ACCESS_KEY, ctx.getHandler())
  if !meta: return true
  req = ctx.switchToHttp().getRequest()
  resourceId = req.params[meta.paramKey] ?? req.body[meta.bodyKey]
  if !resourceId: throw BadRequestException
  tier = await tierCache.get(meta.resource, resourceId)
  if tier === null: throw NotFoundException
  if tier === FREE: return true
  // tier === PREMIUM
  if !req.user: throw ForbiddenException('Premium content requires authentication')
  return subscriptionService.isUserPremium(req.user.id)
    ? true
    : throw new ForbiddenException('Premium subscription required')
```

## Related Code Files
**Modify:**
- `src/common/guards/resource-access.guard.ts` — replace `canActivate` body.

**Verify (no changes expected):**
- `src/common/services/access-tier-cache.service.ts`
- `src/modules/subscription/subscription.service.ts:557 isUserPremium`

## Implementation Steps
1. Remove `void this._reflector; void …` workarounds.
2. Rename private fields: drop leading `_` since they'll be used.
3. Implement `canActivate` per architecture above.
4. Remove the `// TODO: temporarily disabled` comment.
5. `npm run build`.

## Todo List
- [ ] Implement full canActivate flow
- [ ] Remove unused workarounds
- [ ] Update class JSDoc to reflect active behavior
- [ ] `npm run build`
- [ ] Hand off tests to Phase 5

## Success Criteria
- Phase 1 audit findings used to predict 403 behavior.
- Free user hitting premium scenario → 403.
- Premium user hitting premium scenario → 200.
- Any user hitting free scenario → 200.

## Risk Assessment
- Endpoints may start 403'ing if Phase 1 audit missed something. Mitigation: smoke test each `@RequireResourceAccess` route as both free and premium user before deploy.
- `isUserPremium` is per-call DB read — Phase 4 of completed `260503-1950-iap-backend-hardening` added the premium cache, so this is fine.

## Security Considerations
- Unauthenticated case must throw, not silently allow. Guard runs after JWT guard but `@Public()` routes could in theory be decorated → defensive check on `req.user`.
- Resource ID comes from user input → already typed as string by decorator contract; cache `get()` is safe.

## Next Steps
- Phase 4 adds drift log.
