# Scenario Type System Implementation

**Date**: 2026-04-20
**Severity**: Medium
**Component**: Scenarios, KOL Gift Codes, User Roles
**Status**: Resolved

## What Happened

Completed full implementation of discriminated scenario types (default vs. KOL-granted) with gift code redemption system and role-based access control. Feature ships with 347/350 tests passing (3 pre-existing auth failures).

## Technical Decisions

- **ScenarioType enum** on `scenarios` table; `gift_code` column dropped
- **UserAiScenario** table for AI-generated scenarios with app-supplied UUID PK
- **KolBundle + KolBundleScenario** for gift code tracking; composite PK with scenario uniqueness enforced
- **users.roles text[]** replaces `isAdmin boolean`; backfilled via array operations
- **RolesGuard + @Roles()** decorator replaces AdminGuard — extensible for future role types

## Implementation

- 5 reversible TypeORM migrations (1778000000000–1778000400000 range)
- `GET /scenarios/default` — paginated defaults for active language
- `GET /scenarios/personal` — merged AI + KOL scenarios, DESC by addedAt
- `POST /scenarios/redeem` — idempotent gift code (5/min throttle, `orIgnore()` on FK insert)
- `/admin/kol-bundles` endpoints for admin management

## Trade-offs

- `listPersonal` uses in-memory merge+sort (acceptable for bounded user data; SQL UNION noted for optimization)
- `UserScenarioAccess` FK → RESTRICT (preserve grants on archive)
- Admin bootstrap uses `array_append(array_remove())` for idempotency

## Lessons

Discriminated schemas with composite PKs require careful migration sequencing. FK constraints and idempotency guards prevent silent failures in redemption flows. Role arrays are more flexible than boolean flags for future expansion.

## Next Steps

Monitor gift code redemption throttle in production. Plan SQL UNION optimization for `listPersonal` if pagination becomes bottleneck.
