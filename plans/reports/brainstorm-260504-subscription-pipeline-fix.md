# Brainstorm Report — Subscription Pipeline Fix

**Date:** 2026-05-04
**Trigger:** User `89c0be08-19b9-431a-a892-aea1a80d9e99` had subscription + cancelled, but pack still accessible AND `/subscriptions/me` returns null.
**Scope:** One PR. Three code changes + one manual recovery.

---

## Problem Statement

Two independent bugs surfaced from one user report:

- **A.** `GET /subscriptions/me` returns null for user `89c0be08`. DB query confirms zero rows in `subscriptions` for this user_id. Single existing row attributed to a different user (`7aad344a`, secondary Google account same person) with `app_user_id=$RCAnonymousID:239e18be…`.
- **B.** Premium pack stays accessible regardless of subscription state. `ResourceAccessGuard.canActivate` is hardcoded `return true` (TODO at `src/common/guards/resource-access.guard.ts:25-28`).

### Root causes
- **A:** `subscription.service.ts:213-230` `resolveUser` iterates `[app_user_id, original_app_user_id, ...aliases]` and returns first user found. RC's anonymous-purchase-then-login flow leaves the real UUID buried in `aliases[]`; resolver landed events on the older-anonymous-linked account (`7aad344a`) instead of the current logged-in user (`89c0be08`).
- **B:** Guard intentionally disabled during access-logic redesign; never re-enabled.

---

## Approaches Evaluated

| # | Approach | Verdict |
|---|----------|---------|
| 1 | Re-enable guard only, leave resolver alone | Rejected. Activates enforcement on top of broken row routing → more users locked out. |
| 2 | Fix resolver only, leave guard disabled | Rejected. `/me` would work but pack stays free → no business value. |
| 3 | Force `RC.logIn(uuid)` on Flutter side only | Rejected as sole fix. Doesn't recover existing bad rows; backend stays fragile. |
| 4 | **Backend resolver fix + re-enable guard + recovery, one PR** | **Selected.** Linked symptoms, ship together so guard activation doesn't expose more cases. |
| 5 | Defense-in-depth (4 + Flutter `RC.logIn`) | Deferred. Resolver fix alone covers the routing case; app discipline as follow-up. |

---

## Selected Solution

### Change 1 — Re-enable `ResourceAccessGuard`
**File:** `src/common/guards/resource-access.guard.ts`

Restore: read `@RequireResourceAccess` metadata → look up tier via `AccessTierCacheService` → if FREE allow → else `subscriptionService.isUserPremium(userId)` → allow / 403. Unauthenticated request on premium route → 403, not 500.

**Pre-merge audit:** grep all `@RequireResourceAccess` decorations; smoke test each as free + premium user.

### Change 2 — Fix `resolveUser` precedence
**File:** `src/modules/subscription/subscription.service.ts:213-230`

New precedence:
1. `app_user_id` if valid UUID matching `users.id`.
2. Else `original_app_user_id` (same UUID validation).
3. Else iterate `aliases[]`, **emit warning log** on hit.
4. Reject all `$RCAnonymousID:*` (existing behavior, keep).

UUID validation = regex pre-check before DB lookup.

### Change 3 — Drift observability
**File:** `subscription.service.ts` `dispatch()`

After successful resolve, if `existing.appUserId` differs from `event.app_user_id`, log:
```
WARN subscription_user_drift userId=X event_app_user_id=Y stored_app_user_id=Z event=...
```
Grep-able. No new infra.

### Change 4 — Recovery runbook for user `89c0be08`

1. Pull RC dashboard subscriber for `$RCAnonymousID:239e18beb3ac496faac365ad3153d5b7`. Inspect `original_app_user_id`, current `app_user_id`, `aliases[]`, active entitlements.
2. Identify rightful owner UUID per RC ground truth.
3. If owner = `89c0be08`:
   ```sql
   UPDATE subscriptions
   SET user_id = '89c0be08-19b9-431a-a892-aea1a80d9e99',
       app_user_id = '<real UUID from RC>'
   WHERE id = 'a43bda60-bea6-4c5e-bac0-b1794eb76b13';
   ```
   Then emit `subscription.changed` for `89c0be08` to flush cache.
4. If owner = `7aad344a` → no SQL; tell user the active sub is on `dttdotienthanh@`.
5. If both legitimate → user must purchase separately on second account.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Guard re-enable breaks endpoints relying on bypass | Pre-merge audit + smoke tests on each `@RequireResourceAccess` route |
| Resolver change rejects edge-case alias matches that worked | Aliases kept as fallback; warning log surfaces issues without breaking |
| Manual SQL touches wrong account | Step 1 (RC dashboard audit) is mandatory before SQL |
| Cache serves stale row after recovery | Emit `subscription.changed`; verify `AccessTierCacheService` + premium cache invalidate |

---

## Out of Scope

- Flutter `RC.logIn(uuid)` discipline (follow-up).
- Cross-user drift reconciliation cron (build only if log shows recurrence).
- Rewriting `app_user_id` on rows other than the reported case.

---

## Success Criteria

- [ ] `ResourceAccessGuard.canActivate` enforces tier + premium check (unit tests: FREE pass, premium pass, premium 403, unauth 403).
- [ ] `resolveUser` unit tests: app_user_id wins over aliases; aliases-only match emits warning; anonymous IDs skipped.
- [ ] After recovery: `GET /subscriptions/me` for `89c0be08` returns active sub DTO; cancel state reflects correctly.
- [ ] `subscription_user_drift` warning fires on synthetic mismatch event.
- [ ] No regression in webhook idempotency tests.

---

## Next Steps

1. Pre-merge: audit all `@RequireResourceAccess` usages.
2. Implement Changes 1–3 in single PR; add unit tests alongside.
3. RC dashboard inspection for recovery (Change 4 step 1).
4. Execute recovery SQL if owner confirmed.
5. Deploy, monitor `subscription_user_drift` log for 1 week.
6. If drift recurs → escalate to Flutter `RC.logIn(uuid)` work.

---

## Open Questions

- Does `AccessTierCacheService` already invalidate on `subscription.changed`? Verify before Change 1 ships.
- Are there any `@RequireResourceAccess` decorations in code that pre-date the bypass and would 403 unexpectedly?
- Does RC keep `app_user_id` as the most recent `logIn()` UUID, or does anonymous purchase permanently pin `original_app_user_id` to the anonymous ID?
