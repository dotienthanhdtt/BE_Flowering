---
phase: 7
title: "Docs"
status: pending
priority: P3
effort: "1h"
dependencies: [5]
---

# Phase 7: Docs

## Overview

Update API documentation + changelog + codebase summary for the new endpoint and the chat service trigger removal.

## Related Code Files

- Modify: `docs/api-documentation.md` — add `POST /scenario/complete` section
- Modify: `docs/project-changelog.md` — entry under current date
- Modify: `docs/codebase-summary.md` — note `ScenarioCompleteService`, `ScenarioEvaluatorService`, `ScenarioEvaluation` entity
- Modify: `docs/system-architecture.md` — update scenario module diagram if present; note trigger relocation

## Implementation Steps

1. `api-documentation.md`: document endpoint with request/response examples, headers, auth, status codes, idempotency semantics.
2. Example curl in docs:
   ```bash
   curl -X POST $API/scenario/complete \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Learning-Language: en" \
     -H "Content-Type: application/json" \
     -d '{"conversationId":"...","scenarioId":"..."}'
   ```
3. `project-changelog.md`: new entry `feat(scenario): add POST /scenario/complete with LLM evaluation`.
4. `codebase-summary.md`: add scenario_evaluations entity row to the entities list (currently 13 entities → 14).
5. `system-architecture.md`: brief note that personalization trigger now fires from `/complete` only (single entry point).

## Success Criteria

- [ ] API doc has full endpoint spec with example
- [ ] Changelog updated with version-appropriate entry
- [ ] codebase-summary entity count + new service mentions
- [ ] No broken cross-references

## Risk Assessment

- **Risk:** Docs drift if implementation deviates from this plan.
  **Mitigation:** docs phase runs last; verify against shipped API surface.
