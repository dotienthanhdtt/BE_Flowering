# Phase 06 — Docs + Changelog

## Context Links

- Plan overview: `plan.md`
- Blockers: phase 03 (API shape finalized)
- Targets: `docs/api-documentation.md`, `docs/project-changelog.md`

## Overview

- **Priority:** P2
- **Status:** completed
- **Brief:** Update API docs to reflect merged endpoint. Remove `/onboarding/start` section. Add changelog entry with breaking-change marker.

## Key Insights

- Breaking change — call out explicitly in changelog.
- `docs/system-architecture.md` may reference onboarding flow diagram — check.

## Requirements

**Functional**
- Docs describe single `/onboarding/chat` with both branches.
- Changelog lists date, change type (BREAKING), migration notes for clients.

**Non-functional**
- Keep docs style consistent with existing sections.

## Related Code Files

**Modify**
- `docs/api-documentation.md`
- `docs/project-changelog.md`

**Check (maybe modify)**
- `docs/system-architecture.md`
- `docs/project-overview-pdr.md`

## Implementation Steps

1. Grep docs: `rg "onboarding/start" docs/` — list all references.
2. Update `docs/api-documentation.md`:
   - Delete `POST /onboarding/start` section.
   - Rewrite `POST /onboarding/chat` section:
     - Dual payload examples (creation vs chat).
     - Uniform response body example.
     - Throttle note: 5/hr creation, 30/hr chat.
3. Update `docs/project-changelog.md` under today's date:
   ```
   ### 2026-04-14 — BREAKING
   - **API:** Merged `POST /onboarding/start` + `POST /onboarding/chat` into single `POST /onboarding/chat`.
     - Creation branch: omit `conversationId`, include `nativeLanguage` + `targetLanguage`.
     - Chat branch: include `conversationId` + `message`.
     - Response shape uniform: `{conversationId, reply, messageId, turnNumber, isLastTurn}`.
     - `/onboarding/start` removed — no backward compat.
     - Mobile clients must upgrade in lockstep.
   ```
4. If `system-architecture.md` shows onboarding flow, redraw (ASCII or Mermaid) as single-endpoint.
5. Verify all links + curl examples resolve.

## Todo List

- [ ] Grep docs for `/onboarding/start` refs
- [ ] Rewrite `/onboarding/chat` section in api-documentation.md
- [ ] Remove `/onboarding/start` section
- [ ] Add changelog entry
- [ ] Update architecture doc if needed
- [ ] Link/curl spot check

## Success Criteria

- No doc references to `/onboarding/start`.
- Changelog clearly marks breaking change.
- `api-documentation.md` examples runnable against dev server.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stale curl examples copied elsewhere (README, Postman) | Medium | Low | Grep README + `.postman*` files |
| PDR still describes two-step flow | Medium | Low | Update or add pointer to changelog |

## Security Considerations

- Ensure examples don't include real conversation IDs or tokens.

## Next Steps

- Broadcast changelog entry to mobile team + backend team.
- Close plan once deploy verified in prod.
