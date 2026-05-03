# IAP / Subscription Backend Review — 2026-05-03

Scope: `be_flowering/src/modules/subscription/**`, `premium.guard.ts`, `subscription.entity.ts`, RC config.

---

## Critical

### C1. RC `REFUND` event is not handled — refunds do NOT revoke access
- File: `subscription.service.ts:136-165` (dispatch switch); `dto/revenuecat-webhook.dto.ts:14-31` (event type union).
- The DTO union and dispatch switch do not include `REFUND`. RC sends a distinct `REFUND` event for App Store / Play Store refunds. With current code it falls through to `default: Unhandled RC event type` and is silently logged. The user keeps premium access until natural expiry — direct revenue leak and policy violation.
- Note: `REFUND_REVERSED` IS handled (treated as a re-grant, correct), but its inverse is missing.
- Fix: add `REFUND` to the union, route to `handleCancellation` with synthetic `cancel_reason='CUSTOMER_SUPPORT'` (immediate revoke), or a dedicated handler that sets status=EXPIRED and `currentPeriodEnd=now`. Cron reconciliation will eventually catch this if RC stops returning the entitlement, but only at next 03:00 UTC and only for rows already past `currentPeriodEnd` — refunds within an active period will NOT be picked up by cron at all (queries filter by `currentPeriodEnd < now`).

### C2. `applyRcGroundTruth` race: read-modify-write without row lock
- File: `subscription.service.ts:482-546`.
- `findOne` then `update`/`save` without `SELECT ... FOR UPDATE` and not wrapped in a transaction. Two concurrent calls (e.g. PremiumGuard fallback + cron + a webhook arriving at the same time) can interleave: both read `existing`, both write — last-write-wins. The `eventTimestampMs` guard mitigates webhooks-vs-RC conflicts but does NOT protect concurrent `applyRcGroundTruth` calls with the same `fetchedAtMs` (Date.now() collisions are realistic on busy servers; equal ts passes the `<` check).
- Worse: the create-path on line 524 has no unique constraint protection against two simultaneous inserts (unique on `userId` exists per entity — line 36 entity — so one will throw, but the error is unhandled and propagated; PremiumGuard catches it silently via `.catch(() => {})` (guard line 62) so the user sees nothing, but cron will log it as an error).
- Fix: wrap in `dataSource.transaction` and use `subscriptionRepo.findOne({ where: { userId }, lock: { mode: 'pessimistic_write' } })` or use `INSERT ... ON CONFLICT (user_id) DO UPDATE` (upsert). Same pattern needed in `handlePurchaseOrRenewal` (line 220-241) where `existing ? update : save` has the identical race for first-purchase events arriving twice (e.g. INITIAL_PURCHASE retry before idempotency row commits in concurrent dispatch — though the transactional idempotency lock on line 87 mostly closes this, two webhooks for two different users sharing the same code path are fine; risk is webhook + fallback for the same user concurrently).

### C3. PremiumGuard fallback grants access without committing the sync
- File: `premium.guard.ts:60-66`.
- Guard calls `applyRcGroundTruth(...)` without awaiting and swallows the error. If sync fails, the request is granted but the DB stays stale, so every subsequent request also takes the RC fallback path — sustained 100 req/min per active premium user → easy to blow through RC's 100 req/min/project rate limit (project-wide, not per-user).
- Combined with the breaker (5 failures in 5 min → OPEN for 5 min), one stuck user trying to access in a loop can trip the breaker for everyone.
- Fix: `await` the sync (it's a single update; cost is one DB round trip, not user-perceptible) OR add a short in-memory positive cache (e.g. 60s) on `(userId → isPremium)` to avoid repeated RC calls for the same user.

### C4. Webhook auth scheme is non-standard and brittle
- File: `revenuecat-webhook.controller.ts:79-88`.
- RC's documented auth is `Authorization: Bearer <secret>` configured in dashboard. Code compares the FULL `authHeader` byte-for-byte to `expectedSecret` with no scheme stripping. This works only if you stored the literal `"Bearer foo"` (including the word "Bearer") as the dashboard secret — fragile and undocumented in code (the comment on line 76-78 acknowledges "no scheme prefix"). If anyone in the future configures the dashboard with `Bearer foo` while the env contains `foo` (the natural setup), all webhooks 401 silently and RC will retry, eventually shadow-banning the endpoint.
- Also: there is no replay-protection (no nonce / timestamp window). RC does not sign payloads (no HMAC), so a stolen secret = full webhook spoofing forever. If this secret ever leaks (logs, env dump), an attacker can forge INITIAL_PURCHASE for any user.
- Fix: parse `Bearer ` prefix explicitly and compare only the token; document the dashboard configuration; rotate webhook secret periodically; consider IP allow-list of RC's published egress IPs as defense-in-depth; reject events with `event_timestamp_ms` older than e.g. 24h to limit replay window.

### C5. `verifyAuth` short-circuits on length mismatch — possible timing leak
- File: `revenuecat-webhook.controller.ts:80-82`.
- The early `length !== expectedSecret.length` return is faster than `timingSafeEqual`, leaking the secret length. Minor on its own, but combined with no rate limiting on the endpoint (no `@Throttle`, and the controller is `@Public()`), it's a DoS + length-oracle target. Webhook endpoints should also have a body-size limit; default Express limit (100kb? — depends on global config) may be larger than RC ever sends.
- Fix: pad/compare to a fixed length, or accept timing leak only on length but document it; add `@Throttle` and `@Body()` size limit; verify global body-parser limit.

### C6. `whitelist`/`forbidNonWhitelisted` not used on webhook DTO
- File: `dto/revenuecat-webhook.dto.ts:55-167`; controller relies on global `ValidationPipe`.
- Comment on line 51-54 says nested validation is intentionally NOT applied so unknown fields pass through. But that means a malicious sender (with the secret) could put anything in `event` — e.g. arbitrarily long strings beyond declared MaxLengths if the global pipe doesn't enforce nested transformation. Confirm global pipe runs `transform: true` AND the `@Type(() => RevenueCatEventDto)` is sufficient to nest-validate. If `transform` is off or `enableImplicitConversion` is off, all the validators on `RevenueCatEventDto` are silently inert.
- Fix: explicitly add `@ValidateNested()` on the `event` field (currently only `@IsObject` + `@Type`). Without `@ValidateNested`, the inner DTO validators DO NOT RUN — class-validator does not recurse without it. This is almost certainly a bug: `@MaxLength`, `@IsNumber`, `@IsIn` on `RevenueCatEventDto` fields are not actually being enforced today.

---

## Important

### I1. Sandbox-in-prod filter runs BEFORE idempotency record
- File: `subscription.service.ts:70-75`.
- A sandbox event in prod is dropped without recording it, so RC will retry forever (or until exponential backoff caps). Either record it as processed (so RC stops retrying) or return 200 quickly (already returns void → 200 from controller, so RC stops — OK). Verify: yes, controller returns `{status:'received'}`, fine. Soft issue: log noise on every retry. Consider explicit ack record.

### I2. `mapProductToPlan` defaults to MONTHLY on unknown product IDs
- File: `subscription.service.ts:436-442`.
- An unknown product silently becomes `MONTHLY` and the user gets premium. If marketing introduces a new product SKU and forgets to update mapping, every purchase grants the wrong plan — billing/analytics drift, but access still works. Better: explicit map; throw or alert on unknown.

### I3. `currentPeriodStart` not updated on RENEWAL
- File: `subscription.service.ts:220-229` `update` payload includes `currentPeriodStart: purchaseDate` — fine. But `purchased_at_ms` from RC for RENEWAL = renewal purchase time, not original first purchase. Verify product expectation. Likely OK.

### I4. EXPIRATION handler doesn't clear plan or `currentPeriodEnd`
- File: `subscription.service.ts:325-341`.
- After EXPIRATION the row keeps `plan=MONTHLY/YEARLY` and the old `currentPeriodEnd`. `isUserPremium` filters by status=ACTIVE so it's safe today, but `mapToDto` exposes the plan to clients — could mislead UI to show "your YEARLY plan" with isActive=false. Cosmetic but worth normalizing.

### I5. Cron query uses `take: BATCH_SIZE` with no offset / pagination
- File: `subscription-reconciliation.cron.ts:67-73`.
- If candidate count exceeds 100, only the first 100 are reconciled per run; the rest wait 24h. Order is arbitrary (no `order` clause). On a healthy product this is unlikely, but during an RC outage that lasted 24h, the queue could spike. Consider streaming via `findEach`/cursor or running cron more frequently with deterministic ordering by `currentPeriodEnd ASC`.

### I6. Cron: stale subscriptions never enter reconciliation candidate set
- File: `subscription-reconciliation.cron.ts:67-73`.
- Query targets only rows where `currentPeriodEnd < now`. A user who refunds mid-period (see C1) never matches — there's no "RC says inactive but DB says active and within period" path. Fix: also include `status=ACTIVE` rows older than e.g. 7 days since `updatedAt`, OR rely on REFUND webhook handling (preferred — fix C1).

### I7. Out-of-order guard fails on equal timestamps
- File: `subscription.service.ts:194-198, 491`.
- Uses strict `<`. If two events share `event_timestamp_ms` (RC ms granularity, busy account, batched webhooks), both apply in arrival order — last write wins. With current handlers idempotent-like behavior that's mostly fine, but for CANCELLATION (immediate-revoke vs period-end variants) ordering matters. Use `<=` for stale and persist the event id along with ts so equal-ts events are deduplicated by id (already done via webhook_events table — so this is only a concern for non-webhook applyRcGroundTruth).

### I8. `revenuecatId` stores `original_app_user_id` — not RC's subscriber object id
- File: `subscription.service.ts:227, 237`.
- Naming implies it's an opaque RC identifier; it's actually the user-side identifier. If you ever want to cross-reference by RC's internal id, this column doesn't have it. Document or rename.

### I9. TRANSFER handler doesn't move `userId` atomically with conflict check
- File: `subscription.service.ts:419-428`.
- If `toUser` already has a subscription row, the update on `subscription.id` to `userId=toId` will hit the unique constraint on `user_id` (entity line 36) and throw. The whole transaction rolls back, idempotency row removed → RC retries → same error → loop. Add: check `subscriptionRepo.findOne({ where: { userId: toId } })` before relinking; if exists, decide policy (merge? overwrite older? log + skip?).

### I10. PremiumGuard: stale `subscription.isActive` across timezone changes
- File: `subscription.service.ts:457-462`.
- `currentPeriodEnd > new Date()` uses Postgres timestamptz vs JS Date — both UTC in JS, fine. No real bug, but no buffer for clock skew between server and RC; for sub-second renewals there's a moment after expiry-tick where DB says expired but RC has just renewed. PremiumGuard fallback covers this. Acceptable.

### I11. SUBSCRIPTION_PAUSED handler doesn't preserve auto-resume info
- File: `subscription.service.ts:364-377`.
- `auto_resume_at_ms` is captured in DTO but discarded in handler. If the app wants to show "Resumes on X" the data isn't persisted. Minor — could fetch via RC REST.

### I12. Webhook handler logs `app_user_id` at log line 62-64
- File: `revenuecat-webhook.controller.ts:62-64`.
- This is the RC subscriber id which equals our internal user UUID. Generally PII-adjacent (links account → purchase). Acceptable for prod logs but confirm log retention / masking policy.

---

## Minor

### M1. `PG_UNIQUE_VIOLATION` constant duplicated across `processWebhook` and `recordIdempotency`
- DRY: extract `isUniqueViolation(err)` helper. Cosmetic.

### M2. SILENT_ACK still inserts idempotency row outside transaction
- File: `subscription.service.ts:80`. Inconsistent with main path (which is transactional). If RC retries a TEST event and we crash between insert and 200 response, RC retries — handler is a no-op, fine. Acceptable.

### M3. `revenuecat-rest-client` hard-codes `'X-Platform': 'stripe'`
- File: line 102. Comment says "required by RC v1" — verify against RC docs; this looks like a copy-paste from a Stripe integration. RC v1 GET /subscribers does not require X-Platform AFAIK; if it's wrong it might bias entitlement projection. If correct, document the why with a doc link.

### M4. `RcSubscriberPayload.activeProductId` picks "first active" arbitrarily
- File: `revenuecat-rest-client.ts:155-156`. `Object.values` ordering is insertion order in modern V8 but not guaranteed by RC's response. If the user has multiple entitlements, the wrong product may be applied. For a single-tier app it's fine. Document assumption.

### M5. Cron uses Promise.allSettled with no per-task timeout
- File: cron line 89. RC client has 5s timeout, but if the breaker swallows errors it's bounded. OK.

### M6. `handleExtension` updates by `{userId}` not `{id}`
- File: `subscription.service.ts:274-280`.
- Works because `userId` is unique, but if no row exists, `update` silently affects 0 rows. No log. Add an `existing` check or log `affected === 0`.

### M7. `getUserSubscription` returns null for missing — controller exposes that as `null` JSON
- File: controller line 21. Combined with `ResponseTransformInterceptor`, response becomes `{code:1, message:..., data:null}`. Confirm the Flutter client treats `data:null` as "free user" not error. Likely fine; just verify.

### M8. `eventTimestampMs` bigint transformer reads `null` fine but `0` becomes a real ts
- File: `subscription.entity.ts:62-71`. Edge case — RC would never send 0. OK.

### M9. No metrics / alerts on critical paths
- No Prom/Datadog instrumentation visible: webhook errors, breaker open, cron reconcile counts. Logs only. For a revenue surface, add structured metrics.

### M10. Webhook 200 on early returns without body
- Controller returns `{status:'received'}` only on success path. Early returns inside service (sandbox filter, silent-ack, stale event) don't propagate distinct outcomes; controller still 200s. Fine for RC, but operationally consider returning a discriminator for observability.

---

## Notes / Positive

- Idempotency via `webhook_events` table inside the same transaction as the handler is the correct pattern — duplicate event safely no-ops, failure rolls back the idempotency row so RC can retry (line 84-97). Solid.
- Out-of-order timestamp guard exists. Many implementations miss this entirely.
- Circuit breaker for RC REST + fail-open (don't mass-revoke during outage) is the right default for revenue surfaces.
- TRANSFER handler validates both endpoints exist before relinking — prevents silent privilege grants.
- API key never logged; comment on `revenuecat-rest-client.ts:7-8` documents this explicitly.
- Production-prod-startup hard fail on missing `REVENUECAT_REST_API_KEY` (line 60-62).
- Sandbox events filtered in prod (line 70-75).
- CANCELLATION reasons differentiated correctly (period-end vs immediate revoke).
- `isUserPremium` filters out FREE plan even if status=ACTIVE (defensive).

---

## Unresolved Questions

1. Is the global `ValidationPipe` configured with `transform:true` AND does the absence of `@ValidateNested()` on `RevenueCatWebhookDto.event` mean inner validators are skipped today? **High priority to confirm — could be silent validation bypass (C6).**
2. Does RC actually emit a `REFUND` event for this app's store(s), or is `CANCELLATION` with `cancel_reason=CUSTOMER_SUPPORT/BILLING_ERROR` the only refund signal in practice? RC docs imply both can fire depending on integration version. **C1 severity hinges on this.**
3. What's the dashboard-configured webhook authorization value's exact format — `Bearer xyz` literal or just `xyz`? The current `verifyAuth` only works for one of those.
4. Is there a global `@Throttle` / rate-limit applied to `@Public()` endpoints? If not, the webhook endpoint is a DoS target.
5. Body-parser size limit for the webhook route — default Nest/Express is 100kb; RC payloads should fit but worth confirming hard cap.
6. Is the Flutter client trusting any client-side IAP receipt and posting to backend, or is RC the sole source of truth? (Files in scope don't show a client-asserted endpoint, which is good — confirm.)
7. Are RC webhooks allow-listed by IP at the LB / WAF layer? Defense in depth for the secret-only auth model.
8. Is there an alert when the idempotency table grows unbounded? It has no TTL cleanup visible.
