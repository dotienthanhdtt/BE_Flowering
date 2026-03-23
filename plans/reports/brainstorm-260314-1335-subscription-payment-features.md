# Brainstorm: Subscription Payment Features

**Date:** 2026-03-14
**Status:** Agreed
**Timeline:** Urgent (this week)
**Context:** [researcher-260313-backend-subscription-api.md](../../requirement/researcher-260313-backend-subscription-api.md)

---

## Problem Statement

Existing subscription module has RevenueCat webhook integration but lacks:
- Direct API verification (sync endpoint) for missed webhooks
- Feature gating to monetize AI endpoints
- Production-safe webhook idempotency (currently in-memory Set)
- Reliability guarantees (no retry, no dedup persistence)

## Agreed Scope (This Week)

### Priority 1: POST /subscriptions/sync
- **What:** On-demand endpoint to verify subscription with RevenueCat REST API
- **Flow:** Mobile calls after purchase + on every app open → backend hits RC API → upserts local DB → returns fresh SubscriptionDto
- **Edge case:** No RC subscriber record → return FREE plan
- **Why:** Acts as webhook backup, ensures consistency, catches missed events naturally

### Priority 2: @RequirePremium() Feature Gating
- **What:** Custom guard + decorator pattern for AI endpoint restriction
- **Scope:** ALL /ai/* endpoints require active paid subscription
- **Pattern:** `@RequirePremium()` decorator → `PremiumGuard` checks subscription status → 403 if free/expired
- **Location:** Guard in `src/common/guards/`, decorator in `src/common/decorators/`
- **Free endpoints:** None in AI module. Translate + correct currently have @OptionalAuth but will require premium too

### Priority 3: DB-based Webhook Idempotency
- **What:** Replace in-memory Set with `webhook_events` table
- **Schema:** `event_id VARCHAR(255) PK, event_type VARCHAR(50), processed_at TIMESTAMPTZ`
- **Why:** Survives server restarts, no extra infra needed (uses existing Postgres)

### Deferred (Next Iteration)
- Simple webhook event log (subscription history)
- Entitlement mapping
- Usage-based rate limits per plan
- Redis-based idempotency (if DB becomes bottleneck)

---

## Technical Design

### 1. Sync Endpoint

```
POST /subscriptions/sync
Auth: JWT required
Response: BaseResponseDto<SubscriptionDto>
```

**Implementation:**
- Add `syncSubscription(userId)` to `SubscriptionService`
- Call RevenueCat REST API: `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}`
- Auth header: `Authorization: Bearer {REVENUECAT_API_KEY}`
- Parse response → extract active entitlements + product info
- Upsert subscription entity with fresh data
- Return mapped SubscriptionDto

**Files to modify:**
- `src/modules/subscription/subscription.controller.ts` — add POST /sync endpoint
- `src/modules/subscription/subscription.service.ts` — add syncSubscription() + RC API call logic

**New files:**
- None needed (can use built-in fetch or axios for RC API call)

### 2. Premium Guard

```typescript
// src/common/decorators/require-premium.decorator.ts
export const RequirePremium = () => SetMetadata('require_premium', true);

// src/common/guards/premium.guard.ts
@Injectable()
export class PremiumGuard implements CanActivate {
  // Inject SubscriptionService, Reflector
  // Check metadata → fetch subscription → verify active + non-free plan
  // Throw ForbiddenException if not premium
}
```

**Apply to AI controller:**
- Add `@UseGuards(PremiumGuard)` at controller level
- Add `@RequirePremium()` on each endpoint (or controller-level for all)

**Files to modify:**
- `src/modules/ai/ai.controller.ts` — add guard + decorator
- `src/modules/ai/ai.module.ts` — import SubscriptionModule

**New files:**
- `src/common/decorators/require-premium.decorator.ts`
- `src/common/guards/premium.guard.ts`

### 3. Webhook Idempotency Table

```sql
CREATE TABLE webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Files to modify:**
- `src/modules/subscription/subscription.service.ts` — replace in-memory Set with DB lookup
- `src/modules/subscription/subscription.module.ts` — register WebhookEvent entity

**New files:**
- `src/database/entities/webhook-event.entity.ts`
- Migration file for webhook_events table

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| RevenueCat API rate limits | Sync fails on heavy traffic | Cache sync results, don't call RC if last sync < 5min ago |
| Premium guard blocks free users mid-session | Bad UX | Return clear error message with upgrade instructions |
| Migration failure on production | Broken deploys | Test migration locally, webhook_events is independent table |
| RC API key exposure | Security breach | Already in env vars, never log API responses with keys |

## Success Criteria

- [ ] POST /subscriptions/sync returns fresh subscription data from RevenueCat
- [ ] All AI endpoints return 403 for free/expired users
- [ ] Webhook deduplication survives server restart
- [ ] Existing GET /subscriptions/me still works unchanged
- [ ] npm run build passes
- [ ] Basic tests for guard and sync logic

---

## Implementation Order

1. **Webhook event entity + migration** (unblocks idempotency)
2. **DB idempotency in service** (replace in-memory Set)
3. **Sync endpoint** (service + controller)
4. **Premium guard + decorator** (common/ files)
5. **Apply guard to AI controller**
6. **Tests**

## Next Steps

User to confirm if they want a detailed implementation plan created via `/plan`.
