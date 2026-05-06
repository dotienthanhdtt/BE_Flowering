# Phase 07 — Paywall Response + Persistent Resume

## Context Links
- Brainstorm §5.4, §7
- Phase 04 (quota returns `paywall` reason)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** When Premium user hits monthly cap mid-flow at `/complete`, return canonical paywall payload. Conversation row remains so user can resume after upgrade.

## Key Insights
- Project response wrapper is `{code, message, data}`. Paywall = `{code: 0, message: 'upgrade_required', data: {upsellTo: 'premium_plus', conversationId}}`.
- Conversation must NOT be marked complete on paywall — leave open so resume re-runs `/complete`.
- After upgrade webhook updates `accessTier=PREMIUM_PLUS`, next `/complete` call passes quota.

## Requirements
**Functional:**
- `/complete` returns paywall shape on `paywall` reason; HTTP 200 (response code 0 carries semantic).
- Daily ceiling returns distinct error: `{code:0, message:'daily_limit_reached'}`.
- Free user blocked at controller level: 403 (matches global filter).
- Conversation persists across paywall hit; `/messages` still works.

**Non-Functional:**
- No raw exceptions thrown to client (project rule).
- Response shape consistent with `BaseResponseDto`.

## Architecture
`PersonalizationService.complete` returns a discriminated union; controller maps to response. Or service throws a typed `PaywallException` caught by a local interceptor that translates to `{code:0,...}`. Pick simpler: explicit return + controller maps.

## Related Code Files
**Modify:**
- `src/modules/personalization/personalization.controller.ts` — branch on result type
- `src/modules/personalization/personalization.service.ts` — return discriminated result
- `src/modules/personalization/dto/personalize-complete.dto.ts` — add response variants

**Create:**
- `src/modules/personalization/types/complete-result.type.ts`

**Delete:** none

## Implementation Steps
1. Define `CompleteResult = SuccessResult | PaywallResult | DailyCeilingResult`.
2. Update service `complete()`:
   - quota check → if paywall: return `{kind:'paywall', conversationId}` (no extraction wasted? In v1 prefer to gate BEFORE extraction; revisit if UX wants the chat-feel of paywalling AFTER full convo).
   - **Decision:** v1 gate quota BEFORE extraction LLM call (cheaper, simpler). Brainstorm said "paywall mid-flow at extraction" — v1 keeps "mid-flow" by virtue of being at /complete (not at /chat). Document.
   - daily ceiling → `{kind:'daily_ceiling'}`.
3. Controller maps:
   - `success` → `BaseResponseDto.ok({scenarios, generatedNew, quotaRemaining})`.
   - `paywall` → `{code:0, message:'upgrade_required', data:{upsellTo:'premium_plus', conversationId}}`.
   - `daily_ceiling` → `{code:0, message:'daily_limit_reached', data:{}}`.
4. Verify response interceptor doesn't double-wrap. Return raw shape if interceptor wraps automatically.
5. Add `GET /personalization/messages` already exists (Phase 03) — confirm works after paywall (conversation not closed).
6. `npm run build`.

## Todo List
- [ ] CompleteResult type
- [ ] Service returns discriminated union
- [ ] Controller maps each variant
- [ ] No conversation close on paywall
- [ ] Verify /messages still resumable
- [ ] Build clean

## Success Criteria
- Premium 2nd /complete call same month: response `{code:0, message:'upgrade_required', ...}`, HTTP 200.
- Same conversation accessible via /messages afterward.
- After tier upgrade to Plus, next /complete succeeds, returns scenarios.

## Risk Assessment
- **Response interceptor double-wrap** → check `ResponseTransformInterceptor` behavior; bypass if needed via custom decorator.
- **Mobile expects HTTP non-200 for paywall** → confirm mobile contract (out of scope this plan but flag in summary).
- **User abandoned conversation** → soft TTL via DB cleanup later; v1 accepts unbounded growth.

## Security Considerations
- Don't leak quota internals (e.g., other users' usage).
- Conversation ownership re-verified on resume.

## Next Steps
- Phase 08 (pruning) independent. Phase 09 tests both branches.
