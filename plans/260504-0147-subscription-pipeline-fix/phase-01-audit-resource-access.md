# Phase 1 — Audit `@RequireResourceAccess` usages

## Context Links
- Brainstorm: `../reports/brainstorm-260504-subscription-pipeline-fix.md`
- Decorator: `src/common/decorators/require-resource-access.decorator.ts`
- Guard (currently bypassed): `src/common/guards/resource-access.guard.ts:25-28`

## Overview
**Priority:** P0 (gates Phase 3)
**Status:** Pending
Read-only audit to know which endpoints will start enforcing premium gating once the guard is re-enabled.

## Key Insights
- Initial grep shows 2 decorations: `scenarios.controller.ts:80` (paramKey=id) and `scenario-chat.controller.ts:37` (bodyKey=scenarioId).
- Only resource type currently supported is `'scenario'` (`AccessTierCacheService.fetchFromDb`).
- `AccessTier` enum and `Scenario.accessTier` column already exist.

## Requirements
- Confirm complete list of `@RequireResourceAccess`-decorated endpoints.
- Confirm which scenarios in DB have `accessTier=PREMIUM` (these become 403 for free users post-fix).
- Identify any endpoint that should NOT enforce premium and is mistakenly decorated.

## Implementation Steps
1. `grep -rn "@RequireResourceAccess" src/ --include="*.ts" | grep -v test` → list endpoints.
2. `psql … "SELECT access_tier, count(*) FROM scenarios GROUP BY access_tier;"` → distribution.
3. For each endpoint: confirm intended tier behavior with stakeholder (or via existing docs/PRD).
4. If any decoration is wrong → remove or change tier in DB (out-of-scope edits → file in follow-up).

## Todo List
- [ ] Run grep, capture endpoint list
- [ ] Query DB for tier distribution
- [ ] Confirm intent per endpoint
- [ ] Document findings inline in this phase file (Findings section below)

## Findings

`grep -rn "@RequireResourceAccess" src/ --include="*.ts" | grep -v test` → 2 hits:
- `src/modules/scenario/scenarios.controller.ts:80` — `{ resource: 'scenario', paramKey: 'id' }` on the scenario detail route.
- `src/modules/scenario/scenario-chat.controller.ts:37` — `{ resource: 'scenario', bodyKey: 'scenarioId' }` on the chat-message route.

Both endpoints share resource type `'scenario'`. Tier source is `Scenario.accessTier` via `AccessTierCacheService`. Re-enabling the guard will start enforcing 403 for free users on PREMIUM scenarios on those two routes only. No other code surfaces are impacted.

DB tier distribution check is deferred to deploy-time smoke validation (no prod DB read from this session).

## Success Criteria
- Endpoint list documented.
- No surprises at Phase 3 deploy.

## Risk Assessment
- Low. Read-only.

## Next Steps
- Hand off to Phase 2.
