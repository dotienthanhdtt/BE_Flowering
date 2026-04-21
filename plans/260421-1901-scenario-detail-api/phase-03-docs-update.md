# Phase 03 — Docs Update

## Context Links

- Brainstorm: `plans/reports/brainstorm-260421-1901-scenario-detail-api.md`
- Overview plan: `plan.md`
- Depends on: Phase 02 (endpoint must exist and pass tests)

## Overview

**Priority:** P2
**Status:** completed
**Effort:** 30m

Document `GET /scenarios/:id` in `docs/api-documentation.md` under the Scenarios section. Include request/response examples for FREE (unlocked), PREMIUM locked, PREMIUM unlocked, and 404 cases.

## Requirements

### Functional
- Endpoint entry added alongside existing `/scenarios/default` and `/scenarios/personal` docs.
- Sample curl + JSON response body for each behavior-matrix row.
- Document the `X-Learning-Language` header requirement.
- Note `AutoEnrollLanguage` behavior (user auto-enrolled if header provided and not yet on list).

### Non-functional
- Match existing doc style in `api-documentation.md` (scan first to confirm).
- Keep under file's docs.maxLoc=800 ceiling.

## Related Code Files

**Modify:**
- `docs/api-documentation.md`

**No create. No delete.**

## Implementation Steps

1. Read existing `docs/api-documentation.md` to copy section style (heading levels, code-block format, response-body format).
2. Locate the Scenarios section (after `/scenarios/personal`).
3. Add `GET /scenarios/:id` subsection with:
   - Auth requirement + header
   - Path params (`id: uuid`)
   - Response DTO table (field / type / description)
   - 3 sample responses:
     - 200 FREE: `isLocked=false`, no `lockReason`
     - 200 PREMIUM unlocked: `isLocked=false`, `accessTier='premium'`
     - 200 PREMIUM locked: `isLocked=true, lockReason='premium_required'`
   - 404 example
4. Cross-reference from changelog: add one-line entry in `docs/project-changelog.md` under date `2026-04-21`.

## Todo List

- [x] Read existing api-documentation.md format
- [x] Add endpoint section
- [x] Add 3+1 sample responses
- [x] Update `docs/project-changelog.md`
- [x] Verify internal cross-links render

## Success Criteria

- Endpoint documented with all 4 response scenarios.
- Doc style consistent with existing sections.
- Changelog updated.

## Risk Assessment

- Low — pure documentation.

## Next Steps

- Run `/ck:plan archive` after all phases merged to main.
