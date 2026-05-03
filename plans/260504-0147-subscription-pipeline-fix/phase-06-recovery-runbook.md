# Phase 6 — Recovery runbook for user `89c0be08`

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- Affected user: `89c0be08-19b9-431a-a892-aea1a80d9e99` (dotienthanhdtt@gmail.com)
- Existing row owner: `7aad344a-9ec0-4e11-bbd1-00f84e87601f` (dttdotienthanh@gmail.com)
- Subscription row id: `a43bda60-bea6-4c5e-bac0-b1794eb76b13`
- RC anonymous id: `$RCAnonymousID:239e18beb3ac496faac365ad3153d5b7`

## Overview
**Priority:** P0 (user-facing)
**Status:** Pending — execute AFTER Phases 1–5 deployed.
Manual operation. Not part of PR.

## Pre-Conditions
- Phases 1–5 merged and deployed.
- Have RC dashboard access.
- Have prod DB write access.

## Steps

### 1. RC dashboard inspection
1. Open RC dashboard → Customers → search `$RCAnonymousID:239e18beb3ac496faac365ad3153d5b7`.
2. Capture: `original_app_user_id`, current `app_user_id`, full `aliases[]`, active entitlements.
3. Determine **rightful owner UUID** = the UUID of the user whose `RC.logIn()` was the most recent (or whose Apple/Google account holds the IAP receipt).

### 2. Branch by ownership

**Case A — owner is `89c0be08`:**
```sql
-- Verify before run
SELECT id, user_id, app_user_id, plan, status
FROM subscriptions
WHERE id = 'a43bda60-bea6-4c5e-bac0-b1794eb76b13';

-- Transfer
UPDATE subscriptions
SET user_id     = '89c0be08-19b9-431a-a892-aea1a80d9e99',
    app_user_id = '<real UUID from RC dashboard>'
WHERE id = 'a43bda60-bea6-4c5e-bac0-b1794eb76b13';

-- Verify
SELECT id, user_id, app_user_id, status, current_period_end, cancel_at_period_end
FROM subscriptions
WHERE user_id = '89c0be08-19b9-431a-a892-aea1a80d9e99';
```
Then trigger cache flush:
- Restart API pod, OR
- Hit any endpoint as user `89c0be08` to force `subscription.changed` re-read (premium cache TTL is 60s in `260503-1950-iap-backend-hardening` Phase 4).

**Case B — owner is `7aad344a` (current state correct):**
- No SQL.
- Notify user: active subscription is on `dttdotienthanh@gmail.com`. Sign in there, or contact RC support to transfer at the IAP receipt level.

**Case C — both legitimate (separate purchases):**
- Out of scope. User must purchase separately on each app account.

### 3. Verification
- `GET /subscriptions/me` as user `89c0be08` → returns expected DTO.
- `cancelAtPeriodEnd` reflects the user's recent cancel action.
- User confirms pack visibility matches expectation in app.

## Todo List
- [ ] RC dashboard audit complete
- [ ] Owner determined
- [ ] (If Case A) SQL executed + verified
- [ ] Cache flushed
- [ ] User confirms /subscriptions/me correct
- [ ] User confirms pack access correct (gated for free, open for premium)

## Success Criteria
- User reports the issue resolved.
- DB row matches RC ground truth.

## Risk Assessment
- Wrong-account SQL → reverse with the inverse UPDATE; row id is invariant.
- Premium cache stale → 60s TTL bounds blast radius.

## Security Considerations
- Use prod DB access via approved credentials only.
- Capture before/after state in incident log.

## Next Steps
- If drift log fires for other users post-deploy → triage similarly, escalate to Flutter `RC.logIn(uuid)` work if pattern.
