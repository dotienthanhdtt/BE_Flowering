# Code Review: Subscription Payment Features

**Date:** 2026-03-14
**Branch:** feat/phase-correction
**Reviewer:** code-reviewer
**Scope:** Subscription payment features - PremiumGuard, webhook idempotency, sync endpoint

---

## Scope

- **Files reviewed:** 11 (6 modified, 5 new)
- **Focus:** Security, error handling, entity registration, guard correctness, breaking changes

## Overall Assessment

Solid implementation. The DB-based idempotency upgrade, PremiumGuard, and sync endpoint are well-structured. However, there is one **critical breaking change** and a **high-priority race condition** that must be addressed before merge.

---

## Critical Issues

### 1. BREAKING CHANGE: Translation endpoint no longer accessible to onboarding users

**File:** `src/modules/ai/ai.controller.ts` (lines 59-60, 175-196)

The `@OptionalAuth()` decorator was removed from `POST /ai/translate` and `POST /ai/chat/correct`, and the entire controller now requires `@RequirePremium()`. Previously, onboarding users (no JWT, using `sessionToken`) could call translate. Now they get 403.

The `translate()` method still passes `dto.sessionToken` to `TranslationService`, but `@CurrentUser()` will throw before it reaches that code since the global JWT guard requires auth and PremiumGuard requires an active subscription.

**Impact:** Mobile onboarding flow that calls translate will break completely.

**Fix options:**
- (A) Override at method level: add `@RequirePremium(false)` or skip PremiumGuard via a new decorator on translate/correct endpoints
- (B) Move translate to a separate controller (e.g., `TranslateController`) that doesn't have PremiumGuard
- (C) Add `@Public()` + `@SetMetadata(REQUIRE_PREMIUM_KEY, false)` on those specific methods

### 2. BREAKING CHANGE: `POST /ai/chat/correct` now requires premium

**File:** `src/modules/ai/ai.controller.ts` (line 104)

Previously had `@OptionalAuth()` - accessible without JWT. Now requires both authentication AND premium subscription. If mobile currently calls this for free-tier users or onboarding, it will break.

**Impact:** Any free-tier user calling correction check will get 403.

---

## High Priority

### 3. Race condition in webhook idempotency (TOCTOU)

**File:** `src/modules/subscription/subscription.service.ts` (lines 51-91)

The idempotency check and record insertion are not atomic. If RevenueCat sends duplicate webhooks in rapid succession:

```
Request A: findOne(eventId) → null (not found)
Request B: findOne(eventId) → null (not found)  ← race
Request A: processes event, saves webhook_event
Request B: processes event again, tries to save → unique constraint violation OR duplicate processing
```

**Fix:** Use `INSERT ... ON CONFLICT DO NOTHING` or wrap in a transaction with `SELECT FOR UPDATE`:

```typescript
// Option A: catch unique constraint violation
try {
  await this.webhookEventRepo.save({ eventId: event.id, eventType: event.type });
} catch (err) {
  if (err.code === '23505') { // unique_violation
    this.logger.debug(`Event ${event.id} already processed (concurrent), skipping`);
    return;
  }
  throw err;
}
// Then process the event (save acts as lock)
```

Or save the webhook event FIRST (as a lock), then process. If processing fails, delete the record or mark it as failed.

### 4. RevenueCat API key logged in error context

**File:** `src/modules/subscription/subscription.service.ts` (line 206)

`this.logger.error(...)` with the full `error` object could potentially log request details including the Authorization header with the API key if the error object includes request config (as Axios does). Using native `fetch` reduces this risk but the error object shape is not guaranteed.

**Fix:** Log only `error.message` and `error.stack`, not the full error object:

```typescript
this.logger.error(`Failed to sync with RevenueCat for user ${userId}: ${(error as Error).message}`, (error as Error).stack);
```

### 5. `syncSubscription` has no rate limiting

**File:** `src/modules/subscription/subscription.controller.ts` (line 23)

`POST /subscriptions/sync` calls the RevenueCat API on every request. A malicious or buggy client could hammer this endpoint, causing rate limiting on the RevenueCat side (which could affect webhook processing).

**Fix:** Add `@Throttle()` or use ThrottlerGuard on the sync endpoint (e.g., 5 req/min per user).

---

## Medium Priority

### 6. `mapToDto` receives spread object missing `id` field

**File:** `src/modules/subscription/subscription.service.ts` (line 253)

```typescript
return this.mapToDto({ ...existing, plan, status: ... });
```

This works because `existing` has the `id` field, but the spread creates a plain object, not a `Subscription` entity. `mapToDto` calls `this.isSubscriptionActive()` which checks `subscription.status` and `subscription.plan` - these are overridden in the spread. However, the type is `Subscription` but the runtime object is a plain object. This is fragile.

**Fix:** Re-fetch after update or construct properly:

```typescript
Object.assign(existing, { plan, status: SubscriptionStatus.ACTIVE, ... });
return this.mapToDto(existing);
```

### 7. `upsertFromRevenueCat` doesn't handle `product_identifier` being undefined

**File:** `src/modules/subscription/subscription.service.ts` (line 234)

`activeEntitlement.product_identifier` could be undefined if RevenueCat data shape changes. `mapProductToPlan(undefined)` would call `.toLowerCase()` on undefined and crash.

**Fix:** Add null check:

```typescript
const productId = (activeEntitlement.product_identifier as string) ?? '';
```

### 8. No cleanup strategy for webhook_events table

**File:** `src/database/entities/webhook-event.entity.ts`

The `webhook_events` table will grow indefinitely. Consider adding:
- A TTL-based cleanup (cron job to delete events older than 30 days)
- An index on `processed_at` for efficient cleanup queries

### 9. Service file approaching 200-line limit

**File:** `src/modules/subscription/subscription.service.ts` (306 lines)

Exceeds the 200-line guideline. Consider extracting `syncSubscription`, `upsertFromRevenueCat`, and `ensureFreeSubscription` into a separate `subscription-sync.service.ts`.

---

## Low Priority

### 10. `PremiumGuard` throws `ForbiddenException` when user is null

**File:** `src/common/guards/premium.guard.ts` (line 35)

If `user` is null (shouldn't happen since global JWT guard runs first), it throws `ForbiddenException('Authentication required...')`. Should be `UnauthorizedException` for semantic correctness (401 vs 403). But since the global JWT guard handles this case first, this is defense-in-depth only.

### 11. Missing `@ApiResponse` for 403 on AI endpoints

**File:** `src/modules/ai/ai.controller.ts`

No `@ApiResponse({ status: 403 })` added to document the new premium requirement in Swagger. Mobile developers relying on Swagger docs won't know about this change.

---

## Positive Observations

1. **DB-based idempotency** - major improvement over in-memory Set; survives restarts
2. **WebhookEvent entity** registered in both `database.module.ts` AND `subscription.module.ts` - follows the documented pattern correctly
3. **PremiumGuard** design is clean - uses metadata reflection, supports per-method override
4. **Migration** has proper up/down methods with `IF NOT EXISTS`/`IF EXISTS`
5. **Fallback behavior** in `syncSubscription` - gracefully returns current/free subscription when RevenueCat is unavailable
6. **Entity exported** from `index.ts` barrel file

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Restore public/optional access for `POST /ai/translate` and `POST /ai/chat/correct` for onboarding users - or explicitly document this as an intentional breaking change
2. **[HIGH]** Fix TOCTOU race in webhook idempotency - insert-first approach or catch unique constraint
3. **[HIGH]** Sanitize error logging in `syncSubscription` to avoid leaking API keys
4. **[HIGH]** Add rate limiting to `POST /subscriptions/sync`
5. **[MEDIUM]** Add null guard on `product_identifier` in `upsertFromRevenueCat`
6. **[MEDIUM]** Plan webhook_events table cleanup strategy
7. **[MEDIUM]** Split subscription service into focused files
8. **[LOW]** Add 403 Swagger docs to AI endpoints

---

## Unresolved Questions

1. Is the removal of `@OptionalAuth()` from translate/correct intentional? If so, how will onboarding flow handle translations?
2. Should free-tier users still access grammar correction (`POST /ai/chat/correct`)? The previous implementation allowed unauthenticated access.
3. What is the expected rate limit for `POST /subscriptions/sync`? Need to coordinate with mobile team on call frequency.
4. Should `webhook_events` have a TTL or archive strategy?
