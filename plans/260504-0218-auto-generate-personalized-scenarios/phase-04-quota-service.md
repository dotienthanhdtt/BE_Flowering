# Phase 04 — Quota Service

## Context Links
- Brainstorm §5.4
- Phase 01 (`personalizedTrialUsedAt` column, `PREMIUM_PLUS` enum)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Tier-aware quota: Plus unlimited (with 3/day safety ceiling), Premium 1 free trial per UTC calendar month, Free blocked. Returns paywall signal to caller.

## Key Insights
- "Used this month" = `personalizedTrialUsedAt` is non-null AND its UTC year+month equal current UTC year+month.
- Daily ceiling = count of personalized scenario inserts in last 24h ≥ 3 → block (applies to Plus too).
- Quota check is read-only; mutation (set `personalizedTrialUsedAt`) happens in caller after successful generation.

## Requirements
**Functional:**
- `checkQuota(user) → QuotaDecision` where `QuotaDecision = { allowed: bool, reason: 'ok'|'paywall'|'daily_ceiling'|'free_blocked', quotaRemaining?: number }`.
- `markPremiumTrialUsed(userId) → void`.
- Daily ceiling counts rows in `scenarios` where `ownerUserId=user`, `type='personal'`, `createdAt > now()-24h`.

**Non-Functional:**
- Quota check <50ms (single indexed COUNT query).
- Pure function-style: no side effects in `checkQuota`.

## Architecture
```
PersonalizationQuotaService
  ├── checkQuota(user): QuotaDecision
  └── markPremiumTrialUsed(userId): void
```
Consumed by `PersonalizationService.complete()` and `PersonalizationTriggerService` (Phase 06).

## Related Code Files
**Modify:**
- `src/modules/personalization/personalization.service.ts` — call quota in `complete()`
- `src/modules/personalization/personalization.module.ts` — provide service

**Create:**
- `src/modules/personalization/services/personalization-quota.service.ts`
- `src/modules/personalization/types/quota-decision.type.ts`

**Delete:** none

## Implementation Steps
1. Define `QuotaDecision` type.
2. Create `PersonalizationQuotaService` with injected `UserRepository` + `ScenarioRepository`.
3. `checkQuota(user)`:
   - if `accessTier === FREE` → `{allowed:false, reason:'free_blocked'}`.
   - count personal scenarios in last 24h; if ≥3 → `{allowed:false, reason:'daily_ceiling'}`.
   - if `accessTier === PREMIUM_PLUS` → `{allowed:true, reason:'ok'}`.
   - if `PREMIUM`: check `personalizedTrialUsedAt` against current UTC month.
     - same month → `{allowed:false, reason:'paywall'}`.
     - else → `{allowed:true, reason:'ok', quotaRemaining:1}`.
4. `markPremiumTrialUsed`: update `user.personalizedTrialUsedAt = now()`.
5. Wire into `PersonalizationService.complete()`: call check before generation; on `ok` proceed, on `paywall` return paywall response (Phase 07 finalizes shape).
6. Unit tests stub here (full coverage in Phase 09).
7. `npm run build`.

## Todo List
- [ ] QuotaDecision type
- [ ] Quota service implementation
- [ ] Wire into complete()
- [ ] Replace FREE stub with `free_blocked` decision
- [ ] Build clean

## Success Criteria
- Free user → 403 (or paywall-shape error consistent with global filter).
- Premium with trial unused → proceeds; after success, `personalizedTrialUsedAt` set.
- Premium 2nd attempt same month → paywall response.
- Plus 4th attempt within 24h → `daily_ceiling` block.

## Risk Assessment
- **TZ confusion** → DOC explicitly: "v1 = UTC month". Add code comment.
- **Race: two concurrent /complete calls for Premium** → Phase 06 advisory lock covers this; in isolation, quota check + mark not atomic. Note in lock phase.
- **Missing index on `(owner_user_id, type, created_at)`** → confirm centralize-scenarios or Phase 01 added; add here if missing.

## Security Considerations
- Never expose other users' quota.
- `markPremiumTrialUsed` only callable from service-internal context.

## Next Steps
- Phase 05 (de-dup) runs parallel; Phase 07 finalizes paywall response.
