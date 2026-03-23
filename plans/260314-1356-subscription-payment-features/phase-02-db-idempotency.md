# Phase 2: DB-based Webhook Idempotency

**Priority:** High
**Status:** **COMPLETE**
**Depends on:** Phase 1 (WebhookEvent entity)
**Context:** [brainstorm](../reports/brainstorm-260314-1335-subscription-payment-features.md) § Priority 3

---

## Overview

Replace in-memory `Set<string>` with DB lookup using `WebhookEvent` entity for persistent deduplication.

## Key Insights

- Current code: `private processedEvents = new Set<string>()` in `SubscriptionService`
- Check: `if (this.processedEvents.has(event.id)) { return; }`
- Add: `this.processedEvents.add(event.id)` after processing
- Replace all three touchpoints with repository calls

## Related Code Files

**Modify:**
- `src/modules/subscription/subscription.service.ts` — replace Set with WebhookEvent repository

## Implementation Steps

1. Inject `@InjectRepository(WebhookEvent)` into `SubscriptionService` constructor

2. Remove `private processedEvents = new Set<string>()`

3. Replace idempotency check in `processWebhook()`:
   ```typescript
   // Before processing
   const existing = await this.webhookEventRepo.findOne({
     where: { eventId: event.id },
   });
   if (existing) {
     this.logger.log(`Duplicate webhook event ${event.id}, skipping`);
     return;
   }
   ```

4. After successful processing, save event:
   ```typescript
   await this.webhookEventRepo.save({
     eventId: event.id,
     eventType: event.type,
   });
   ```

5. Run `npm run build`

## Todo

- [x] Inject WebhookEvent repository
- [x] Remove in-memory Set
- [x] Replace check with DB lookup (insert-first pattern for TOCTOU prevention)
- [x] Save event after processing
- [x] Verify build passes

## Success Criteria

- No in-memory Set references remain
- Webhook dedup survives server restart
- Duplicate webhooks are rejected with log message
- `npm run build` passes

## Risk Assessment

- **Low** — straightforward swap, same logic flow
- DB write adds ~5ms latency per webhook — negligible for webhook processing
