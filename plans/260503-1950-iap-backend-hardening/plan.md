---
name: IAP / Subscription Backend Hardening
created: 2026-05-03
status: complete
branch: dev
blockedBy: []
blocks: []
context: ../reports/code-review-260503-1854-iap-backend.md
completed: 2026-05-03
---

# IAP / Subscription Backend Hardening

> **Status: All 7 phases complete (2026-05-03).** Phase 5/6/7 review feedback (idempotent migration guards, real supertest webhook E2E, env-gated race integration test) addressed. See `plans/reports/code-review-260503-2130-iap-hardening-phases-5-7.md`.

## Overview

Remediate findings from `code-review-260503-1854-iap-backend.md` covering RevenueCat webhook handling, the `subscription` module, premium guard, and reconciliation cron. Six **critical** items (revenue leak on refund, race conditions, sync-grant fallback, webhook auth, validation bypass) plus a batch of **important** correctness/observability fixes.

## Phases

| # | Phase | Status | Issues Addressed | Files |
|---|-------|--------|------------------|-------|
| 1 | [Webhook Validation & Auth](phase-01-webhook-validation-auth.md) | Complete | C4, C5, C6 | controller, dto, main |
| 2 | [Refund Handling + Cron Expansion](phase-02-refund-and-cron.md) | Complete | C1, I6 | service, dto, cron |
| 3 | [Race Conditions (Transactional Locks)](phase-03-race-condition-locks.md) | Complete | C2, I7, I9, M6 | service |
| 4 | [Premium Guard Sync + Cache](phase-04-premium-guard-sync.md) | Complete (2026-05-03) | C3 | premium.guard |
| 5 | [Important Correctness Fixes](phase-05-important-fixes.md) | Complete (2026-05-03) | I2, I4, I5, I8, I11 | service, cron |
| 6 | [Minor Fixes & Observability](phase-06-minor-and-observability.md) | Complete (2026-05-03) | M1, M3, M4, M9, M10 | service, client |
| 7 | [Tests](phase-07-tests.md) | Complete (2026-05-03) | All above | test/* |

## Dependencies

- Phase 1 independent (auth/validation, no service-logic overlap).
- Phase 2 → Phase 3 (refund handler must exist before lock refactor wraps it).
- Phase 3 → Phase 4 (guard cache reasons about post-lock invariants).
- Phases 5–6 independent, can land any order after 2–4.
- Phase 7 runs last, exercises everything.

## Key Decisions

- **Refund** routes to a new dedicated handler (status=EXPIRED, currentPeriodEnd=now) — not piggybacked on CANCELLATION, so analytics can distinguish.
- **Race fix** uses `dataSource.transaction` + pessimistic_write; upsert is rejected because TypeORM's `upsert()` does not return the prior row, which we need for the timestamp guard.
- **Webhook auth** keeps the bare-token format (avoid prod outage from rotating dashboard config) but adds an explicit `Bearer ` prefix-strip with documented dual-format support and rate limiting.
- **Validation**: add `@ValidateNested()` on `event`. Inner DTO already declares `MaxLength`/`IsIn` — these become enforced; expect zero behavior change for well-formed RC payloads.
- **Premium guard** awaits sync (one DB round-trip) and adds a 60s in-memory positive cache keyed by userId to bound RC fan-out.
- **No metrics platform yet** → Phase 6 adds structured log fields (`event=`, `outcome=`, `latency_ms=`) ready for log-based metrics; defer Prom/DD wiring.

## Out of Scope

- C-level architectural changes (moving to a queue, event sourcing).
- IP allow-listing at LB/WAF (infra ticket, not code).
- Idempotency table TTL cleanup (separate housekeeping plan).

## Risk Summary

- Phase 3 transaction refactor is the highest-risk change; requires careful test coverage of concurrent webhook + cron + guard fallback.
- Phase 1 `@ValidateNested()` may surface previously-tolerated malformed payloads from RC — mitigation: log-only one release, then enforce.
