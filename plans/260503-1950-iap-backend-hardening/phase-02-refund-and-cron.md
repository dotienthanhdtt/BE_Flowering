# Phase 2 — Refund Handling + Cron Expansion

**Issues:** C1 (revenue leak on refund), I6 (cron candidate set too narrow)
**Risk:** High — direct revenue/policy impact.

## Context

- Report §C1, §I6
- `subscription.service.ts:136-165` — dispatch switch
- `dto/revenuecat-webhook.dto.ts:14-31` — event type union
- `cron/subscription-reconciliation.cron.ts:67-73` — candidate query

## Requirements

1. Add `REFUND` to `RevenueCatEventType` union.
2. Implement `handleRefund(event)`:
   - Sets `status --=EXPIRED`, `currentPeriodEnd=now`, `cancelledAt=now`, `cancelReason='REFUND'`.
   - Idempotent (reuses webhook_events idempotency wrapper already in `processWebhook`).
   - Out-of-order timestamp guard applies (use existing `<=` after Phase 3 fix).
3. Wire `case 'REFUND'` in dispatch to `handleRefund`.
4. **Cron expansion (I6):** broaden candidate query so refunded-mid-period rows are caught even if RC stops returning the entitlement before our `currentPeriodEnd`:
   - Existing: `currentPeriodEnd < now`
   - Add: OR `(status = ACTIVE AND updatedAt < now - 7 days)` — periodic re-check.
   - Cap with `take: BATCH_SIZE` and add `order: { currentPeriodEnd: 'ASC', updatedAt: 'ASC' }` for determinism (also addresses I5 partially).

## Implementation Steps

1. `dto/revenuecat-webhook.dto.ts:14-31` — extend the union: add `'REFUND'` between `'CANCELLATION'` and `'UNCANCELLATION'`. Update `@IsIn([...])` array on the `type` field.
2. `subscription.service.ts`:
   - New private `handleRefund(event: RevenueCatEventDto)` near `handleCancellation`. Body: load `existing` by userId; if missing, log+skip; else update `{ status: EXPIRED, currentPeriodEnd: new Date(event.event_timestamp_ms), cancelledAt: new Date(), cancelReason: 'REFUND', eventTimestampMs: event.event_timestamp_ms }`.
   - Add `case 'REFUND': await this.handleRefund(event); break;` to dispatch switch (~L150).
3. `cron/subscription-reconciliation.cron.ts:67-73`:
   ```ts
   const now = new Date();
   const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
   const candidates = await this.subscriptionRepo.find({
     where: [
       { currentPeriodEnd: LessThan(now), status: Not(SubscriptionStatus.EXPIRED) },
       { status: SubscriptionStatus.ACTIVE, updatedAt: LessThan(sevenDaysAgo) },
     ],
     order: { currentPeriodEnd: 'ASC', updatedAt: 'ASC' },
     take: BATCH_SIZE,
   });
   ```
   Verify the `Not(EXPIRED)` clause — keeps cron from re-touching already-final rows.

## Files

- Modify: `src/modules/subscription/dto/revenuecat-webhook.dto.ts`
- Modify: `src/modules/subscription/subscription.service.ts`
- Modify: `src/modules/subscription/cron/subscription-reconciliation.cron.ts`

## Todo

- [x] Extend event type union (string-literal — no `@IsIn` on `type` field; pre-existing gap, backlog I2)
- [x] Implement `handleRefund` (with `eventTimestampMs` guard-preserve fix per C1)
- [x] Dispatch wiring
- [x] Broaden cron candidate query + ordering (uses `In([ACTIVE, PAUSED])` not `Not(EXPIRED)` per H1)
- [x] `npm run build` passes
- [ ] Manual: post a synthetic REFUND payload via curl — verify DB row flips to EXPIRED

## Implementation Notes

- `cancelledAt` / `cancelReason` from plan spec were omitted — those columns do not exist on the Subscription entity. The simpler EXPIRED + currentPeriodEnd=now form is the final approach.
- Cron uses `In([ACTIVE, PAUSED])` instead of `Not(EXPIRED)` to avoid pulling legacy CANCELLED rows nightly.
- `handleRefund` preserves existing `eventTimestampMs` when incoming event has no timestamp to prevent nulling out the out-of-order guard (C1 fix).
- Backlog: add `@IsIn([...])` runtime validator on the `type` field (I2). Pass pre-loaded subscription through dispatch to eliminate double-query (H2).

## Success Criteria

- A REFUND event for an active subscriber immediately revokes premium (status=EXPIRED, currentPeriodEnd<=now).
- Cron picks up an ACTIVE row whose `updatedAt` is >7 days old even when `currentPeriodEnd` is in the future.
- No regression to existing CANCELLATION / EXPIRATION / REFUND_REVERSED handling.

## Risks

- If RC actually emits REFUND alongside CANCELLATION for the same refund event, ordering guard prevents double-revoke; both are idempotent in net effect (status=EXPIRED).
- Broader cron query may pull more rows; bounded by `take: BATCH_SIZE`.

## Unresolved Question (from review)

> Does RC actually emit a `REFUND` event for this app's store(s), or is `CANCELLATION` with `cancel_reason=CUSTOMER_SUPPORT/BILLING_ERROR` the only refund signal in practice?

Action: implement `REFUND` handler unconditionally (cheap, idempotent). Concurrently, log a warn when CANCELLATION arrives with `cancel_reason=CUSTOMER_SUPPORT|BILLING_ERROR` so we can audit production data and confirm the channel.
