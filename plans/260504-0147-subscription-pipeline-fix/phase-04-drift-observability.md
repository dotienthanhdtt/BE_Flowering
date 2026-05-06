# Phase 4 — Drift observability

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- File: `src/modules/subscription/subscription.service.ts` (`dispatch` method)

## Overview
**Priority:** P1
**Status:** Pending
Surface webhook events whose `app_user_id` differs from the stored row — the silent symptom that produced the original bug.

## Key Insights
- Mismatch indicates either RC alias linking changed or app failed to call `RC.logIn(uuid)` correctly.
- Today: zero visibility. Drift only detected when user reports missing subscription.
- Single WARN log line is enough — no metrics platform yet (consistent with completed IAP hardening Phase 6 decision).

## Requirements
- After successful `resolveUser` and `existing` lookup in `dispatch()`, compare `existing.appUserId` vs `event.app_user_id`.
- On mismatch (and when both non-null), emit:
  ```
  WARN subscription_user_drift userId=<resolved> event_app_user_id=<from event> stored_app_user_id=<from row> event_type=<type> event_id=<id>
  ```
- Skip log when `existing` is null (new row) or one side is null/anonymous.

## Architecture
Inline check in `dispatch()` after the `existing` query, before the switch.

## Related Code Files
**Modify:**
- `src/modules/subscription/subscription.service.ts` — `dispatch` method only.

## Implementation Steps
1. After `const existing = await subscriptionRepo.findOne(...)` block (line ~157-160).
2. Add: if both `existing?.appUserId` and `event.app_user_id` non-null and differ → `this.logger.warn(...)`.
3. Skip if either side starts with `$RCAnonymousID:` (legitimate state during anon→logged-in transition).
4. `npm run build`.

## Todo List
- [ ] Add drift comparison in dispatch
- [ ] Verify log fields are grep-able (key=value pairs)
- [ ] `npm run build`
- [ ] Hand off test to Phase 5

## Success Criteria
- Synthetic mismatch event in unit test triggers the warn log.
- No log on first-time row creation (existing == null).

## Risk Assessment
- Log volume — only fires on mismatch, expected near-zero in normal operation.

## Next Steps
- Monitor log for 1 week post-deploy. If recurrence → escalate to Flutter `RC.logIn(uuid)` audit.
