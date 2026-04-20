# Phase 06 — Docs Update

## Context Links

- Docs to touch: `docs/api-documentation.md`, `docs/system-architecture.md`, `docs/project-changelog.md`, `docs/codebase-summary.md`, `docs/mobile-api-reference.md`
- Source of truth: all phase files in this plan + brainstorm

## Overview

- Priority: P2
- Status: done
- Update living docs to reflect the new scenario type system, role array, and 3 new endpoints. Add entries to changelog.

## Requirements

### Functional

- **`api-documentation.md`**: add section for `/scenarios/default`, `/scenarios/personal`, `/scenarios/redeem`. Include request/response examples, query params, error codes. Keep the existing `/lessons` section — note it is preserved for lesson content.
- **`system-architecture.md`**: update scenario data-flow diagram to reflect:
  - `scenarios` table restricted to default+KOL content
  - new `user_ai_scenarios` table for personalized
  - `kol_bundles` / `kol_bundle_scenarios` for KOL redemption
  - `users.roles[]` array
- **`project-changelog.md`**: single entry dated 2026-04-20 covering this feature — schema changes, new endpoints, `isAdmin` deprecation.
- **`codebase-summary.md`**: update entity count (18 -> 21) and list new entities. Update module list to include `ScenariosModule`, `KolBundleModule`.
- **`mobile-api-reference.md`**: add migration note: client should move from `GET /lessons` to `GET /scenarios/default` (response shape differs — call out mapping).
- **`code-standards.md`**: add note on role checking pattern (`RolesGuard` + `@Roles(...)`) replacing `AdminGuard`.

### Non-Functional

- No dead links after update (verify cross-references).
- `isAdmin` strings purged from docs (except in deprecation/migration note).

## Related Code Files

### Modify

- `docs/api-documentation.md`
- `docs/system-architecture.md`
- `docs/project-changelog.md`
- `docs/codebase-summary.md`
- `docs/mobile-api-reference.md`
- `docs/code-standards.md`

### Create

- None.

## Implementation Steps

1. Draft changelog entry first (single source of truth):
   ```markdown
   ## 2026-04-20 — Scenario Type System

   ### Schema
   - Added `scenarios.type` enum discriminator (`default`, `kol`)
   - Removed `scenarios.gift_code` (moved to `kol_bundles`)
   - New tables: `user_ai_scenarios`, `kol_bundles`, `kol_bundle_scenarios`
   - Replaced `users.is_admin` with `users.roles text[]`; existing admins backfilled to `['admin','user']`
   - `user_scenario_access.scenario_id` FK relaxed from ON DELETE CASCADE to ON DELETE RESTRICT

   ### API
   - New: `GET /scenarios/default` (paginated default scenarios)
   - New: `GET /scenarios/personal` (merged personalized + KOL-granted, sorted by addedAt desc)
   - New: `POST /scenarios/redeem` (JWT + rate-limited gift-code redemption)
   - New (admin): `POST/GET /admin/kol-bundles`, `POST /admin/kol-bundles/:id/scenarios`

   ### Migration Notes
   - Client migration: switch from `GET /lessons` to `GET /scenarios/default` for scenario listing
   - `AdminGuard` replaced by `RolesGuard` + `@Roles('admin')`
   ```
2. Update `api-documentation.md` with the 3 new endpoints (example requests, headers, response shape).
3. Update `system-architecture.md` — scenario section diagram + role-based access section.
4. Update `codebase-summary.md` — entity list, module list, count.
5. Update `mobile-api-reference.md` — migration note + new endpoint references.
6. Update `code-standards.md` — role guard pattern.
7. Grep docs for stale refs: `grep -rn 'isAdmin\|is_admin\|gift_code on scenario' docs/`. Replace/remove.

## Todo List

- [ ] Changelog entry drafted and pasted
- [ ] `api-documentation.md` updated (3 endpoints + admin bundle endpoints)
- [ ] `system-architecture.md` scenario + role diagrams updated
- [ ] `codebase-summary.md` entity/module counts correct
- [ ] `mobile-api-reference.md` migration note added
- [ ] `code-standards.md` role guard section added
- [ ] Grep for stale `isAdmin` / `gift_code` in docs — zero hits
- [ ] Cross-reference links checked

## Success Criteria

- All 6 docs files updated; changelog entry present.
- No stale `isAdmin` references in `docs/` (outside migration context).
- Swagger at `/api/docs` shows 3 new endpoints matching doc descriptions.
- Mobile team has clear migration path from `/lessons` to `/scenarios/default` in `mobile-api-reference.md`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Docs drift from code (response shapes mismatch) | Med | Low | Copy response DTO examples from actual Swagger output |
| Mobile team misses migration note, keeps calling /lessons | Med | Med | Changelog + mobile-api-reference explicit banner |
| Diagrams rot quickly as feature grows | High | Low | Keep prose-first, diagrams minimal |

## Security Considerations

- None — documentation only. Avoid leaking internal table names in mobile-facing docs (those are fine in system-architecture).

## Next Steps

- None — closing plan.
