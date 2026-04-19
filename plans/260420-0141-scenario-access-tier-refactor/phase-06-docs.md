# Phase 06 — Docs sync

## Context Links
- Docs: `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/api-documentation.md`, `docs/mobile-api-reference.md`, `docs/project-changelog.md`
- Follows rule in `.claude/rules/documentation-management.md`

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Update docs to reflect new entity shape, visibility logic, and mobile contract. Log the breaking change in changelog.

## Key Insights
- `docs/codebase-summary.md` lines 291, 304–306: scenario/lesson schema docs list the dropped bool fields — must replace with `access_tier` row.
- `docs/system-architecture.md` lines 289–308: visibility-filter pseudocode and status-computation block reference the removed flags — rewrite.
- `docs/api-documentation.md` line 423: "Only active scenarios (is_active = true)" → "Only published scenarios (status = published)".
- `docs/mobile-api-reference.md` + `docs/api-documentation.md`: if sample responses include scenario objects with `is_active`/`is_premium` fields, update to show `access_tier` and remove `status: 'trial'` from any example.
- `docs/project-changelog.md`: add entry under today (2026-04-20) describing breaking change — trial collapsed, flag soup removed.

## Requirements

### Functional
- Schema docs list `access_tier` (enum: free, premium) for Scenario + Lesson
- Remove bullets for `is_premium`, `is_trial`, `is_active` on those entities
- Rewrite visibility filter pseudocode:
  ```
  Scenario is visible if:
    (scenario.status = 'published') AND
    (cat.is_active = true) AND
    (scenario.language_id = requested_language_id OR
     scenario.id IN user_scenario_access(user_id))
  ```
- Rewrite status computation:
  ```
  scenario_status = {
    'learned'   if user completed scenario (future)
    'locked'    if access_tier == 'premium' && user.subscription.plan == 'free'
    'available' otherwise
  }
  ```
- Add changelog entry:
  ```
  ## [Unreleased] — 2026-04-20
  ### Breaking
  - **Scenario/Lesson access model refactor.** Dropped `is_premium`, `is_trial`, `is_active` columns.
    Added single `access_tier` enum (`free` | `premium`). Active/archived semantics moved to
    existing `status` (ContentStatus). Mobile DTO `ScenarioStatus.trial` removed — trial scenarios
    are now plain free. DB migration `1777001000000-refactor-content-access-tier`.
  ```

### Non-functional
- Keep doc formatting consistent with surrounding sections
- Do not restructure unrelated doc sections

## Architecture
N/A — documentation-only phase.

## Related Code Files

**Modify:**
- `docs/codebase-summary.md` (lines ~291, 294–309, 311–319)
- `docs/system-architecture.md` (lines ~289–308)
- `docs/api-documentation.md` (line ~423; audit for sample responses)
- `docs/mobile-api-reference.md` (lines ~139, 183 for unrelated language `is_active`; leave untouched — those are language objects, not scenarios. Only update if scenario samples exist.)
- `docs/project-changelog.md` — prepend new entry

## Implementation Steps
1. Grep sample JSON in mobile/api docs for `"is_premium"` / `"is_trial"` / `"is_active"` (under scenario contexts only) — update to `access_tier`. Preserve unrelated entities (`languages`, `user_languages`, `subscription`).
2. Rewrite Scenario Entity section in `codebase-summary.md`.
3. Rewrite Lesson Entity section in `codebase-summary.md` (section around line 311–318 — add `access_tier` line).
4. Rewrite visibility + status-computation blocks in `system-architecture.md`.
5. Update scenario "Only active scenarios" phrase in `api-documentation.md`.
6. Prepend changelog entry.
7. Verify no dead links; verify referenced file paths still exist.

## Todo List
- [x] Update `codebase-summary.md` scenario + lesson sections
- [x] Update `system-architecture.md` visibility + status blocks
- [x] Update `api-documentation.md` active-scenario phrase + any sample JSON
- [x] Audit `mobile-api-reference.md` for scenario samples (skip language samples)
- [x] Prepend `project-changelog.md` entry dated 2026-04-20
- [x] `grep -n "is_premium\|is_trial" docs/` returns 0 hits (scenario/lesson context)

## Success Criteria
- All modified doc sections accurately describe new model
- Changelog carries breaking-change notice
- No stale references to dropped fields in scenario/lesson docs
- Doc cross-references (file paths, migration names) verified to exist

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Accidentally edit unrelated `is_active` on language/user-language samples | Low | Low | Grep filters by surrounding table name; manual review |
| Changelog date/format inconsistent | Low | Low | Follow first existing entry's pattern |

## Security Considerations
N/A.

## Next Steps
- After phase 06 complete, notify orchestrator: all 6 phases done. Ready for PR.
- Recommend smoke test against local dev DB + Swagger UI inspection at `/api/docs`.
