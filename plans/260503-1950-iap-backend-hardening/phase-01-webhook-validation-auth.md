# Phase 1 — Webhook Validation & Auth Hardening

**Issues:** C4, C5, C6
**Risk:** Medium — auth changes can shadow-ban the endpoint if misconfigured.

## Context

- Report: `../reports/code-review-260503-1854-iap-backend.md` §C4–C6
- `revenuecat-webhook.controller.ts:79-88`
- `dto/revenuecat-webhook.dto.ts:55-167`
- `src/main.ts:22-30` — global `ValidationPipe` already has `transform:true, whitelist:true`.

## Requirements

1. **C6 — Enforce inner DTO validation.** Add `@ValidateNested()` (alongside existing `@IsObject` + `@Type(() => RevenueCatEventDto)`) on `RevenueCatWebhookDto.event`. Without this, every `@MaxLength`/`@IsNumber`/`@IsIn` on `RevenueCatEventDto` is silently inert. Confirmed via main.ts pipe config.
2. **C4 — Robust auth scheme.** Strip optional `Bearer ` prefix before comparison; accept both `Bearer <token>` and bare `<token>` dashboard configs. Document the supported formats in a JSDoc on `verifyAuth`. Reject events older than 24h (`event_timestamp_ms < now - 24h`) to bound replay window.
3. **C5 — Length-leak / DoS surface.** Apply `@Throttle` (e.g. 60/min per IP) on the webhook route. Verify body-parser limit (set explicit `bodyParser.json({ limit: '256kb' })` for the webhook path or globally if not yet configured). Keep length-mismatch short-circuit (timing leak on length is acceptable for a fixed-length secret) but document it.
4. Ensure on local startup that `REVENUECAT_WEBHOOK_SECRET` is non-empty in prod (already enforced for REST API key — extend the same hard-fail).

## Implementation Steps

1. `dto/revenuecat-webhook.dto.ts` — import `ValidateNested` from `class-validator`; decorate `event` field. Update the comment to reflect new behavior.
2. `webhooks/revenuecat-webhook.controller.ts`:
   - Add helper `private extractBearer(header: string): string` that strips `Bearer ` (case-insensitive) once.
   - Update `verifyAuth` signature to accept the extracted token, or call extractor inside.
   - In `handleWebhook`, reject if `Math.abs(now - event_timestamp_ms) > 24 * 3600 * 1000` with a 200 ack-and-drop (so RC stops retrying) — log at `warn`.
   - Add `@Throttle({ default: { limit: 60, ttl: 60_000 } })` decorator on the controller method (verify ThrottlerModule already wired globally; if not, scope-only).
3. `src/main.ts` — confirm/raise `app.use(json({ limit: '256kb' }))` for the webhook path (or leave global if already bounded). Comment the choice.
4. `src/config/configuration.ts` (or wherever env validation lives) — add `REVENUECAT_WEBHOOK_SECRET` to the prod hard-fail list mirroring `REVENUECAT_REST_API_KEY` (`subscription.service.ts:60-62`).

## Files

- Modify: `src/modules/subscription/dto/revenuecat-webhook.dto.ts`
- Modify: `src/modules/subscription/webhooks/revenuecat-webhook.controller.ts`
- Modify: `src/main.ts` (body limit verification only — minimal)
- Modify: `src/config/*` (env validation — locate existing pattern, extend)

## Todo

- [x] Add `@ValidateNested()` to `event` field
- [x] Implement Bearer-prefix-tolerant auth
- [x] Add 24h replay window check (200 ack on stale)
- [x] Add `@Throttle` to webhook route
- [x] Verify/set body-parser limit
- [x] Hard-fail on missing secret in prod
- [x] `npm run build` passes

## Success Criteria

- Malformed inner event payload (e.g. `id` longer than 255 chars) is now rejected with 400.
- Both `Authorization: Bearer xxx` and `Authorization: xxx` succeed when secret is `xxx`.
- Replay of a >24h-old event returns 200 with `outcome=stale_dropped` log.
- 61st request from same IP in 60s returns 429.

## Risks

- `@ValidateNested()` may reject previously-tolerated malformed RC fields. **Mitigation:** Deploy with a feature flag or one-release log-only mode is overkill for a pure-validation tightening; instead, add structured logging on validation failures and monitor for 24h post-deploy.
- Throttle limit too tight blocks bursty RC redelivery storms. 60/min/IP allows comfortable RC behavior; revisit if logs show 429s from RC IPs.
