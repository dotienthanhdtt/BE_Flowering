# Phase 4 — Premium Guard Sync + Cache

**Issues:** C3 (guard fallback grants without committing sync; can hammer RC)
**Risk:** Medium — guard runs on every premium-gated request.

## Context

- Report §C3
- `premium.guard.ts:60-66`

## Requirements

1. **Await `applyRcGroundTruth`** instead of fire-and-forget. One DB round-trip on cache miss is acceptable.
2. **In-memory positive cache (60s TTL).** Map `userId → { isPremium: true, expiresAt }`. Prevents repeated RC calls for the same active user during normal traffic.
3. **No negative cache.** Free-user check is a single DB read on `subscriptionRepo`; caching `false` invites a stale-grant lag after purchase. Keep current behavior for non-premium users.
4. **Cache invalidation on webhook write.** When `subscription.service.ts` mutates a subscription row, emit a small in-process event (Nest `EventEmitter`) carrying `userId`. Guard subscribes and evicts the entry. Optional but cheap; do it.
5. Surface guard errors at `error` log level instead of silent `.catch(() => {})`. Still fail-open (don't deny premium during transient RC failures), but with visibility.

## Implementation Steps

1. `premium.guard.ts`:
   - Add `private cache = new Map<string, { isPremium: boolean; expiresAt: number }>()`.
   - In canActivate: check cache → return cached value.
   - On miss: read DB; if active+inPeriod → cache+grant; else attempt `await this.subscriptionService.applyRcGroundTruth(userId)` then re-read DB.
   - Wrap RC sync in try/catch; on error, log+fail-open per existing breaker semantics.
   - Set entry TTL to 60s.
2. `subscription.service.ts`: inject `EventEmitter2`. After every mutation, `eventEmitter.emit('subscription.changed', { userId })`.
3. Guard `@OnEvent('subscription.changed')` handler clears the cache entry.
4. Verify `EventEmitterModule.forRoot()` is registered in `AppModule`; if not, register.

## Files

- Modify: `src/modules/subscription/premium.guard.ts`
- Modify: `src/modules/subscription/subscription.service.ts`
- Modify: `src/app.module.ts` (EventEmitter registration if missing)

## Todo

- [ ] Add 60s positive cache to guard
- [ ] Await sync + log errors
- [ ] Emit `subscription.changed` on mutations
- [ ] Subscribe guard to invalidation event
- [ ] `npm run build` passes
- [ ] Unit test: cache hit, cache miss, eviction-on-event (Phase 7)

## Success Criteria

- A premium user making 100 requests in 60s triggers 1 DB read, 0 RC calls (cache warm).
- Webhook delivering a CANCELLATION evicts the cache; next request re-reads DB and sees expired status.
- RC sync failure no longer silently grants — request still grants on stale-positive DB row, but error is logged.

## Risks

- Per-instance cache → on multi-instance deploy, eviction event fires only on the originating node. Stale positive cache for ≤60s on other nodes after a CANCELLATION. Acceptable: 60s is tight enough for revenue-policy purposes; tighten or move to Redis if MRR-impactful.
