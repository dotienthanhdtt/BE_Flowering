# Phase 06 — Trigger Service + Scenario-Chat Hook

## Context Links
- Brainstorm §5.3
- Phase 03, 04, 05 (consumes service, quota, dedup)
- Source: `src/modules/scenario/services/scenario-chat.service.ts`

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** When user completes scenario flagged `triggersPersonalization`, fire offer event. Race-safe via Postgres advisory lock on `userId`.

## Key Insights
- Trigger is a non-blocking side effect of scenario completion — must NOT fail the parent request if trigger errors.
- Advisory lock prevents double-fire on retried requests / rapid completion events.
- Trigger emits event/notification; does NOT auto-start LLM (user opts in by opening chat).

## Requirements
**Functional:**
- `maybeTrigger(userId, scenarioId) → void` (fire-and-forget, internal errors logged not thrown).
- Pre-checks: scenario.triggersPersonalization, user tier (Free → drop), quota check (Premium with no trial OR Plus pass), dedup pre-check (skip if recent + no expected new info — soft check, may relax).
- Emits `PersonalizationOfferedEvent` (Nest EventEmitter or simple log + push notification trigger).
- Uses `pg_advisory_xact_lock(hashtext('personalize:' || userId))` inside trigger txn.

**Non-Functional:**
- Trigger call adds <100ms to scenario completion.
- Idempotent: same (userId, scenarioId) within short window does not re-fire.

## Architecture
```
ScenarioChatService.handleCompletion(userId, scenarioId)
  └── PersonalizationTriggerService.maybeTrigger(userId, scenarioId)  // async, swallow errors
        ├── advisory lock on userId
        ├── load scenario; check triggersPersonalization
        ├── load user; check tier
        ├── quota.checkQuota(user); drop if free_blocked / paywall (Premium can still chat — paywall is mid-flow)
        ├── (optional v1: skip pre-dedup; rely on /complete dedup)
        └── emit event → notification module
```

## Related Code Files
**Modify:**
- `src/modules/scenario/services/scenario-chat.service.ts` — invoke trigger on completion
- `src/modules/personalization/personalization.module.ts` — provide trigger service, export
- `src/modules/scenario/scenario.module.ts` — import PersonalizationModule (or use forwardRef if circular)

**Create:**
- `src/modules/personalization/services/personalization-trigger.service.ts`
- `src/modules/personalization/events/personalization-offered.event.ts`

**Delete:** none

## Implementation Steps
1. Locate scenario completion hook in `scenario-chat.service.ts`. Confirm signature.
2. Create `PersonalizationOfferedEvent` (userId, conversationHint).
3. Create `PersonalizationTriggerService.maybeTrigger`:
   - wrap in try/catch; log + swallow errors.
   - run inside `dataSource.transaction(...)` to use advisory lock.
   - SQL: `SELECT pg_advisory_xact_lock(hashtext($1))` with `'personalize:'+userId`.
   - load scenario + user; gate checks.
   - if pass: `eventEmitter.emit('personalization.offered', event)`.
4. Wire emit into existing notification path (push notification + in-app feed). If notification module not yet listener-aware, just emit + log; Phase 10 wires push.
5. Inject trigger service into `ScenarioChatService`. Call AFTER successful completion persistence (don't block transaction).
6. Handle module circular dep: prefer `PersonalizationModule` exports `TriggerService`, `ScenarioModule` imports — no circular if Personalization doesn't import Scenario module. If circular, use `forwardRef`.
7. `npm run build`.

## Todo List
- [ ] Event class
- [ ] Trigger service with advisory lock
- [ ] Hook into ScenarioChatService completion
- [ ] Module wiring (resolve any circular)
- [ ] Errors swallowed + logged
- [ ] Build clean

## Success Criteria
- Completing a flagged scenario as Plus user fires event exactly once (verify via log/test).
- Completing as Free user: no event.
- Concurrent double-completion (simulated): only one event fires.
- Trigger error does NOT fail scenario completion response.

## Risk Assessment
- **Circular module imports** → use `forwardRef` if needed; document.
- **Advisory lock held too long** → keep critical section minimal; checks only.
- **Event listener not yet wired** → v1 acceptable; logged. Phase 10 confirms.
- **Hash collision on `hashtext(userId)`** → acceptable; collisions just serialize unrelated triggers, no correctness issue.

## Security Considerations
- Trigger runs server-side only; user cannot self-fire.

## Next Steps
- Phase 07 paywall response (Premium hits trigger → starts chat → /complete returns paywall).
