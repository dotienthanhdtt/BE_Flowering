# Phase 6 — Minor Fixes & Observability

**Issues:** M1, M3, M4, M9, M10
**Risk:** Low.

## Context

- Report §M1, §M3, §M4, §M9, §M10

## Requirements

1. **M1 — DRY unique-violation check.** Extract `isUniqueViolation(err: unknown): boolean` helper into `subscription.service.ts` (or a small `db-errors.util.ts`). Replace duplicate constants in `processWebhook` and `recordIdempotency`.
2. **M3 — Verify `X-Platform: stripe` header.** Cross-check RC v1 GET /subscribers docs. If unnecessary, remove. If required, add a doc-comment with link. Owner: confirm during implementation; default action is remove the header (RC public docs do not list it as required for v1 subscribers endpoint).
3. **M4 — `activeProductId` selection.** Make explicit: pick the entitlement with the latest `purchase_date` (parse `purchase_date_ms`), tie-break by lexical product id for determinism. Document the choice in JSDoc.
4. **M9 — Structured logs as proto-metrics.** Add `event=`, `outcome=`, `latency_ms=`, `userId=` (hashed if PII concern) fields to every webhook + cron + RC client log line. Use existing logger; emit JSON-friendly shape so log-based metrics can derive counters later.
   - Webhook outcomes: `processed`, `duplicate`, `sandbox_dropped`, `stale_dropped`, `validation_failed`, `auth_failed`, `error`.
   - Cron outcomes: `reconciled`, `unchanged`, `breaker_open`, `error`.
5. **M10 — Outcome propagated to controller response.** Service handlers return a small enum value; controller maps to `{status: <outcome>}` body. Useful for `curl` debugging without log access. Keep 200 status on all benign outcomes.

## Implementation Steps

1. New file (≤30 lines): `src/modules/subscription/utils/db-errors.util.ts` exporting `isUniqueViolation`.
2. Replace inline checks in `subscription.service.ts`.
3. `clients/revenuecat-rest-client.ts:102` — remove or document `X-Platform`. Confirm via `curl https://api.revenuecat.com/v1/subscribers/<id>` against staging; if 200 without the header, drop it.
4. `clients/revenuecat-rest-client.ts:155-156` — replace `Object.values(entitlements).find(e => e.expires_date_ms > now)` with explicit sort by `purchase_date_ms desc, product_id asc` then pick first active.
5. Add a tiny `LogContext` builder helper or inline structured fields throughout webhook/cron/client code. Avoid a big logger refactor — incremental adoption is fine.
6. `subscription.service.ts` `processWebhook` returns `{ outcome: 'processed' | 'duplicate' | ... }`. Webhook controller spreads into response body.

## Files

- New: `src/modules/subscription/utils/db-errors.util.ts`
- Modify: `src/modules/subscription/subscription.service.ts`
- Modify: `src/modules/subscription/clients/revenuecat-rest-client.ts`
- Modify: `src/modules/subscription/webhooks/revenuecat-webhook.controller.ts`
- Modify: `src/modules/subscription/cron/subscription-reconciliation.cron.ts`

## Todo

- [ ] Extract `isUniqueViolation`
- [ ] Verify/remove `X-Platform`
- [ ] Deterministic `activeProductId` pick
- [ ] Structured log fields on webhook + cron + client
- [ ] Service returns outcome → controller propagates
- [ ] `npm run build` passes

## Success Criteria

- `grep '23505' src/modules/subscription/` returns 1 result (in the helper only).
- Logs from a duplicate webhook show `outcome=duplicate event=INITIAL_PURCHASE`.
- Webhook controller response body includes `outcome` field.

## Risks

- Removing `X-Platform` if it's actually required by RC silently breaks all REST sync. Validate against staging RC first.
