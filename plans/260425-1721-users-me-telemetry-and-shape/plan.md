---
title: /users/me telemetry + response reshape
status: pending
created: 2026-04-25
mode: fast
blockedBy: []
blocks: []
---

# /users/me telemetry + response reshape

**Authoritative spec:** `plans/reports/brainstormer-260425-users-me-telemetry-and-shape.md`

## Summary

Mobile pings `/users/me` on app foreground with device telemetry. Backend persists each call as an append-only event, returns reshaped response with `{profile, subscription}`.

**Hard break** — replaces `GET /users/me` with `POST /users/me`. No backwards compat.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | DB migration: `user_device_events` + `subscription.tier` + `PENDING` status | pending |
| 2 | Entities + DTOs | pending |
| 3 | Service layer (DeviceEventService, extended UserService) | pending |
| 4 | Controller GET→POST + new response shape | pending |
| 5 | Tests + docs | pending |

## Key dependencies

- Phase 1 → 2 → 3 → 4 → 5 (strict serial; each builds on prior).
- Phase 5 tests cover all prior phases.

## Decisions (locked)

- Append-only event log (no upsert).
- IDFA stored raw, no retention (⚠ flagged in brainstorm).
- ISO 8601 dates.
- Client `time_stamp` only (no server `created_at` for client-supplied time).
- Telemetry write failure ≠ request failure (swallow + log).
- `tier` backfill: `status='trial'` → `TRIAL`; `plan='free'` → `FREE`; else `PREMIUM`. PREMIUM_PLUS set later via RevenueCat.

## Out of scope

- RevenueCat webhook tier mapping (follow-up).
- Event-log retention/partitioning (follow-up).
- IDFA hashing.
- Android GAID handling (reuse `idfa` column if mobile sends it).
