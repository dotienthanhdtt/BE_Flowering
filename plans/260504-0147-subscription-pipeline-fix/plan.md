---
name: Subscription Pipeline Fix
created: 2026-05-04
status: complete
branch: dev
blockedBy: []
blocks: []
context: ../reports/brainstorm-260504-subscription-pipeline-fix.md
---

# Subscription Pipeline Fix

## Overview

Two bugs from user `89c0be08-19b9-431a-a892-aea1a80d9e99` report:
- **A.** `/subscriptions/me` returns null — webhook resolved subscription to wrong user (`7aad344a`) due to RC alias-based user resolution preferring older anonymous-linked account.
- **B.** Premium pack still accessible — `ResourceAccessGuard.canActivate` is hardcoded `return true` (TODO).

Single PR fixes resolver precedence + re-enables guard + adds drift observability + manual recovery for the affected user.

Builds on completed `260503-1950-iap-backend-hardening`.

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [Pre-merge audit @RequireResourceAccess](phase-01-audit-resource-access.md) | Complete | (read-only) |
| 2 | [Fix resolveUser precedence](phase-02-fix-resolver-precedence.md) | Complete | subscription.service.ts |
| 3 | [Re-enable ResourceAccessGuard](phase-03-reenable-resource-access-guard.md) | Complete | resource-access.guard.ts |
| 4 | [Drift observability](phase-04-drift-observability.md) | Complete | subscription.service.ts |
| 5 | [Tests](phase-05-tests.md) | Complete | __tests__/* |
| 6 | [Recovery runbook for user 89c0be08](phase-06-recovery-runbook.md) | Complete (Case B — no SQL) | (manual) |

## Dependencies

- Phase 1 gates Phase 3 (must know which endpoints will start enforcing).
- Phase 2 → Phase 3 (resolver fix lands first so guard activation doesn't expose more wrong-row cases).
- Phase 4 independent of 2/3.
- Phase 5 covers all of 2/3/4.
- Phase 6 runs **after** deploy of 1–5 (manual operation, separate from PR).

## Key Decisions

- **Resolver precedence**: `app_user_id` > `original_app_user_id` > `aliases[]`. UUID validation pre-check before DB lookup. Aliases match still allowed but emits warning log (signals app-side `RC.logIn` discipline issue).
- **Guard re-enable**: full restore of original tier + premium check flow. No env flag — premium gating is product requirement, not feature flag candidate.
- **Drift log**: structured WARN line, no metrics infra. Build cron only if drift recurs.
- **Recovery**: RC dashboard audit mandatory before SQL. No guessing.

## Out of Scope

- Flutter `RC.logIn(uuid)` discipline (follow-up plan if drift log shows recurrence).
- Cross-user drift reconciliation cron.
- Rewriting `app_user_id` on rows other than user `89c0be08`.

## Risk Summary

- Re-enabling guard may 403 endpoints that silently relied on bypass → mitigated by Phase 1 audit + smoke tests.
- Resolver precedence change may reject edge-case alias matches that *were* working → mitigated: aliases kept as fallback with warning, not removed.
- Manual SQL on production DB → mitigated: RC dashboard audit first, exact WHERE-by-id, single row.
