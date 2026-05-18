# Runbook: Unknown SKU in IAP Flow

## Overview

When RevenueCat sends a webhook event with a `product_id` that doesn't match any known plan
prefix (`monthly`, `yearly`, `lifetime`), the backend writes `plan='unknown'` with a hard 7-day
cap on `current_period_end` instead of throwing (which previously caused RC to retry indefinitely).

## When to Investigate

- Railway log line contains `unknown_product_id` (level: `error`)
- A subscription row has `plan = 'unknown'`
- User reports premium access but plan shows incorrectly in app

## Triage SQL

Run on the production database (Railway console or `psql`):

```sql
-- Find all unknown-plan rows
SELECT id, user_id, status, current_period_end, updated_at
FROM subscriptions
WHERE plan = 'unknown'
ORDER BY updated_at DESC;

-- Find the RC events that produced the unknown rows
SELECT event_id, event_type, event_payload->>'product_id' AS product_id, created_at
FROM pending_subscription_claims
WHERE event_type IN ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE')
  AND event_payload->>'product_id' NOT LIKE '%monthly%'
  AND event_payload->>'product_id' NOT LIKE '%yearly%'
  AND event_payload->>'product_id' NOT LIKE '%lifetime%'
ORDER BY created_at DESC
LIMIT 50;
```

## Log Search (Railway)

Filter: `unknown_product_id`

Fields logged: `productId`, `eventId`, `userId`, `cappedUntil`

Example log line:
```
unknown_product_id productId=flowering_promo_30d_ios eventId=abc123 userId=uuid cappedUntil=2026-05-25T10:00:00.000Z
```

## Resolution Steps

1. **Identify the product ID** from the log or triage SQL above.
2. **Check RevenueCat dashboard** — verify the product exists and is correctly configured.
3. **Add the product prefix** to `mapProductToPlan` in `subscription.service.ts` if it is a legitimate new SKU.
4. **Re-run affected subscriptions** — after deploying the fix, affected users can trigger
   re-reconciliation by opening the app (GET /subscriptions/me runs reconciliation automatically).
5. **Manual correction** if needed:
   ```sql
   -- Correct a specific row (after verifying the correct plan)
   UPDATE subscriptions
   SET plan = 'monthly', current_period_end = '<correct_date>'
   WHERE id = '<subscription_id>';
   ```

## Review Cadence

- Check Railway logs for `unknown_product_id` at least **daily** during active release windows.
- Set up a Railway log alert filter for `unknown_product_id` to notify the on-call engineer.

## Escalation

If more than 5 `unknown` rows appear within 24h, escalate to the backend team lead — this
likely indicates a new SKU was launched without updating `mapProductToPlan`, or RC is sending
unexpected product identifiers.
