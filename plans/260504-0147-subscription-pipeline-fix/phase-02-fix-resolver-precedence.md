# Phase 2 — Fix `resolveUser` precedence

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- File: `src/modules/subscription/subscription.service.ts:213-230`

## Overview
**Priority:** P0
**Status:** Pending
Make webhook user resolution prefer the current logged-in UUID (`app_user_id`) over older anonymous-aliased accounts.

## Key Insights
- Current code loops `[app_user_id, original_app_user_id, ...aliases]`, returns first user found, filters out `$RCAnonymousID:*`.
- Bug: when aliases contain multiple UUIDs (cross-account linking), first match wins regardless of which is the *current* user.
- Root cause why user `89c0be08` has zero rows: events resolved to aliased account `7aad344a` instead.

## Requirements
- `app_user_id` wins when it's a valid UUID matching a `users.id`.
- `original_app_user_id` is second priority (same UUID validation).
- `aliases[]` iteration kept as fallback **but emits warning log on hit**.
- All `$RCAnonymousID:*` candidates rejected (existing behavior).
- UUID validation via regex pre-check before DB lookup (skip wasted queries on garbage).

## Architecture
No new services. Pure in-place change to `resolveUser`.

```
event → [app_user_id?, original_app_user_id?, ...aliases]
       → filter: not anonymous + matches UUID regex
       → for each candidate (in priority order):
            user = userRepo.findOne({ id })
            if user:
              if matched via aliases[] → log warn
              return user
       → return null
```

## Related Code Files
**Modify:**
- `src/modules/subscription/subscription.service.ts` — `resolveUser` only.

**No new files.**

## Implementation Steps
1. Add UUID regex constant at module top:
   `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`
2. Refactor `resolveUser` to evaluate `app_user_id` first, then `original_app_user_id`, then iterate `aliases[]`.
3. Each candidate passes `UUID_RE.test()` AND `!startsWith('$RCAnonymousID:')` before DB lookup.
4. Track which branch matched; if `aliases[]` branch → `this.logger.warn('resolveUser_via_aliases userId=… event_id=…')`.
5. `npm run build` to confirm no TS errors.

## Todo List
- [ ] Add UUID_RE constant
- [ ] Rewrite resolveUser with priority branches
- [ ] Add aliases-match warning log
- [ ] `npm run build`
- [ ] Hand off tests to Phase 5

## Success Criteria
- `app_user_id` UUID match takes priority over aliases.
- Anonymous IDs still rejected.
- No regression in existing webhook tests.

## Risk Assessment
- Edge case: an event with `app_user_id` as a non-UUID string but valid alias would now skip app_user_id branch. Mitigation: aliases fallback covers it.

## Security Considerations
- UUID regex prevents accidental SQL on attacker-controlled non-UUID strings (defense in depth; TypeORM already parameterizes).

## Next Steps
- Phase 5 adds unit tests for the three branches.
