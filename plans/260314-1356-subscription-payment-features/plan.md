# Subscription Payment Features

**Created:** 2026-03-14
**Branch:** feat/phase-correction
**Status:** **COMPLETE**
**Context:** [brainstorm-260314-1335](../reports/brainstorm-260314-1335-subscription-payment-features.md)

---

## Overview

Add sync endpoint, premium feature gating, and DB-based webhook idempotency to subscription module.

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [Webhook Event Entity + Migration](phase-01-webhook-event-entity.md) | **Complete** | 3 new, 2 modified |
| 2 | [DB Idempotency in Service](phase-02-db-idempotency.md) | **Complete** | 1 modified |
| 3 | [Sync Endpoint](phase-03-sync-endpoint.md) | **Complete** | 2 modified |
| 4 | [Premium Guard + Decorator](phase-04-premium-guard.md) | **Complete** | 4 new/modified |
| 5 | [Apply Guard to AI Controller](phase-05-apply-guard-ai.md) | **Complete** | 2 modified |

## Dependencies

- Phase 1 → Phase 2 (entity needed for DB idempotency)
- Phase 3 independent (can parallel with 1-2)
- Phase 4 → Phase 5 (guard needed before applying)

## Key Decisions

- Use built-in `fetch` for RevenueCat API (no new deps)
- `@RequirePremium()` at AI controller level (all AI endpoints)
- `@OptionalAuth()` endpoints (translate, correct) will also require premium when auth is present
- Webhook event table uses `event_id` as PK (natural key from RevenueCat)
