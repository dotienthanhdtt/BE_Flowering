# Runbook: IAP Webhook Auth Alerts

## Overview

RevenueCat webhooks are authenticated via a shared secret (`REVENUECAT_WEBHOOK_SECRET`).
Any request that fails the HMAC/token check is rejected with 401 and logged as `outcome=auth_failed`.
This runbook covers the manual log-review cadence and escalation triggers.

## Log Search (Railway)

Filter: `outcome=auth_failed`

Review frequency: **at least daily**, more often during active release windows or after secret rotation.

Example log line:
```
event=INITIAL_PURCHASE outcome=auth_failed id=<event_id> userId=unknown
```

## Normal vs. Abnormal

| Scenario | Expected count | Action |
|----------|---------------|--------|
| Misconfigured RC dashboard (wrong secret) | 1–3 on deploy | Verify secret matches RC dashboard |
| RC retrying a previously-failed event | 0 (idempotency handles these) | None |
| Sustained `auth_failed` spike (>5 in 1h) | Abnormal | See escalation below |
| `auth_failed` from unknown IPs | Abnormal | See escalation below |

## Escalation Triggers

Escalate to backend team lead **immediately** if any of these are observed:

1. **>5 `auth_failed` events within any 1-hour window** — possible leaked webhook secret or
   brute-force attempt against the webhook endpoint.
2. **`auth_failed` events from IPs outside RevenueCat's known ranges** — potential replay attack.
   Cross-reference against [RevenueCat's webhook IP list](https://www.revenuecat.com/docs/integrations/webhooks#ip-addresses).
3. **`auth_failed` events immediately after a secret rotation** — verify the new secret was
   correctly set in both Railway environment variables and the RC dashboard.
4. **Sustained `auth_failed` combined with new `pending_subscription_claims` rows** —
   an attacker may be probing the webhook endpoint; pending rows from forged events are harmless
   (they require live RC confirmation to grant access) but should be audited.

## Blast Radius of a Leaked Secret

Forged events from a leaked webhook secret are stored as `pending_subscription_claims` rows
but **never granted** — `claimVerifiedFor` requires live RC API confirmation under the
authenticated user's UUID. The blast radius is therefore limited to:

- Noise in `pending_subscription_claims` (harmless, no premium access granted).
- Log volume (may obscure legitimate events).

## Remediation Steps

1. **Rotate webhook secret** in RevenueCat dashboard and update `REVENUECAT_WEBHOOK_SECRET`
   in Railway environment variables. Redeploy to pick up the new value.
2. **Audit `pending_subscription_claims`** for rows created during the suspected compromise window:
   ```sql
   SELECT id, event_id, rc_app_user_id, event_type, created_at
   FROM pending_subscription_claims
   WHERE created_at BETWEEN '<start_of_window>' AND '<end_of_window>'
     AND claimed_at IS NULL
   ORDER BY created_at ASC;
   ```
3. **Mark suspicious rows** with a placeholder `claimed_at` to prevent future replay if the
   investigation confirms they are forged:
   ```sql
   UPDATE pending_subscription_claims
   SET claimed_at = NOW(), claimed_by_user = NULL
   WHERE id IN ('<ids_from_above>');
   ```
4. **Verify no subscriptions were incorrectly activated** during the window:
   ```sql
   SELECT id, user_id, plan, status, updated_at
   FROM subscriptions
   WHERE updated_at BETWEEN '<start_of_window>' AND '<end_of_window>'
     AND status = 'active'
   ORDER BY updated_at DESC;
   ```

## Review Cadence

| Frequency | Action |
|-----------|--------|
| Daily | Search Railway logs for `outcome=auth_failed`; count and note source IPs |
| Weekly | Review `pending_subscription_claims` for unclaimed rows older than 7 days |
| After each secret rotation | Verify `auth_failed` count drops to 0 within 5 minutes |
| After each RC dashboard change | Re-verify webhook URL and secret configuration |
