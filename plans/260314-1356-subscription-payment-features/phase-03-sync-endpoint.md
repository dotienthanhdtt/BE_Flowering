# Phase 3: Sync Endpoint

**Priority:** High
**Status:** **COMPLETE**
**Depends on:** None (independent)
**Context:** [brainstorm](../reports/brainstorm-260314-1335-subscription-payment-features.md) § Priority 1

---

## Overview

Add `POST /subscriptions/sync` to verify subscription with RevenueCat REST API and upsert local DB.

## Key Insights

- Acts as webhook backup — mobile calls after purchase + on every app open
- RevenueCat API: `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}`
- Auth: `Authorization: Bearer {REVENUECAT_API_KEY}` (already in env)
- No RC subscriber record → return FREE plan (don't error)
- Use built-in `fetch` — no new dependencies needed

## Related Code Files

**Modify:**
- `src/modules/subscription/subscription.controller.ts` — add `POST /sync` endpoint
- `src/modules/subscription/subscription.service.ts` — add `syncSubscription()` method

## Implementation Steps

1. Add `syncSubscription(userId: string)` to `SubscriptionService`:
   ```typescript
   async syncSubscription(userId: string): Promise<Subscription> {
     const user = await this.userRepo.findOneOrFail({ where: { id: userId } });

     // Call RevenueCat API
     const rcApiKey = this.configService.get<string>('revenuecat.apiKey');
     const response = await fetch(
       `https://api.revenuecat.com/v1/subscribers/${userId}`,
       {
         headers: {
           'Authorization': `Bearer ${rcApiKey}`,
           'Content-Type': 'application/json',
         },
       },
     );

     if (!response.ok) {
       // No subscriber record → return/create FREE plan
       return this.ensureFreeSubscription(userId);
     }

     const data = await response.json();
     // Parse entitlements → determine plan + status
     // Upsert subscription entity
     return this.upsertFromRevenueCat(userId, data.subscriber);
   }
   ```

2. Add helper `upsertFromRevenueCat(userId, subscriberData)`:
   - Extract active entitlements from `subscriber.entitlements`
   - Map product identifier to `SubscriptionPlan` enum
   - Determine `SubscriptionStatus` from expiration dates
   - Upsert subscription record

3. Add helper `ensureFreeSubscription(userId)`:
   - Find or create subscription with `plan: FREE, status: ACTIVE`

4. Add `POST /sync` to controller:
   ```typescript
   @Post('sync')
   @ApiOperation({ summary: 'Sync subscription with RevenueCat' })
   @ApiOkResponse({ type: SubscriptionDto })
   async syncSubscription(@CurrentUser() user: User) {
     const subscription = await this.subscriptionService.syncSubscription(user.id);
     return plainToInstance(SubscriptionDto, subscription);
   }
   ```

5. Ensure `REVENUECAT_API_KEY` is in config (check `.env.example`)

6. Run `npm run build`

## Todo

- [x] Add syncSubscription() to service
- [x] Add upsertFromRevenueCat() helper
- [x] Add ensureFreeSubscription() helper
- [x] Add POST /sync to controller
- [x] Verify REVENUECAT_API_KEY config path
- [x] Verify build passes

## Success Criteria

- `POST /subscriptions/sync` returns fresh subscription data
- No RC record → returns FREE plan (no error)
- Existing subscription updated with RC data
- New subscription created if none exists
- `npm run build` passes

## Risk Assessment

- **RC API rate limits** — mitigated by mobile calling only on purchase + app open (not continuous)
- **RC API downtime** — return existing subscription from DB as fallback
- **Config key path** — verify `revenuecat.apiKey` matches actual config structure
