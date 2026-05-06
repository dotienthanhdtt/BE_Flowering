# Phase 05 — Specs + Verification

**Priority:** P0
**Status:** pending
**Depends on:** Phase 03, Phase 04

## Context Links

- All five spec files in `src/modules/scenario/services/`
- Brainstorm § Success Criteria

## Overview

Update existing specs to match new architecture. Add tests asserting privacy filter (owner_id) in every read path. Verify migration rollback.

## Files

**Modify:**
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `src/modules/scenario/services/scenarios-listing.service.spec.ts`
- `src/modules/scenario/services/scenarios-detail.service.spec.ts`
- `src/modules/scenario/services/scenario-access.service.spec.ts`
- `src/modules/scenario/services/scenarios-redeem.service.spec.ts`

## Implementation Steps

### scenario-chat.service.spec.ts
1. Drop "falls back to user_ai_scenarios when scenarios table misses" test
2. Add: "resolves personal scenario via findVisibleToUser"
3. Add: "rejects scenario owned by another user"
4. Add: "POST /chat succeeds for type=personal" (integration via service mock)

### scenarios-listing.service.spec.ts
1. `listDefault` test: assert query filters `type='system'` AND `ownerId IS NULL`
2. `listPersonal` test: returns personal owned + KOL granted, never another user's personal

### scenarios-detail.service.spec.ts
1. Drop two-step lookup test
2. Add: "returns source='system'/'kol'/'personalized' based on type"
3. Add: "404 when scenario owned by different user"

### scenario-access.service.spec.ts
1. Test all three new helpers
2. Test premium gate uniformly applies to owner of personal scenario without subscription (Option B)
3. Test owner with active subscription accesses premium personal scenario

### scenarios-redeem.service.spec.ts
1. Add: "ignores non-KOL rows even if bundle references one"

## Verification

1. `npm test` — all green
2. `npm run build` — clean
3. `npm run lint` — clean
4. Manual end-to-end on dev DB:
   - `POST /scenario/chat` with KOL scenario → 200
   - `POST /scenario/chat` with personal scenario → 200 (the original bug)
   - `POST /scenario/chat` with another user's personal scenario → 404
   - Migration up + down + up cycle clean

## Todo

- [ ] All five spec files updated
- [ ] `npm test` green
- [ ] `npm run build` clean
- [ ] `npm run lint` clean
- [ ] Manual smoke checklist passes
- [ ] Migration up/down cycle verified

## Success Criteria

- Test count not reduced (replaced, not deleted)
- Privacy assertions present in every listing/detail spec
- Original 500 reproducible scenario now returns 200

## Risks

| Risk | Mitigation |
|---|---|
| Spec mocks don't match new repo helper signatures | Update mocks alongside service refactor |
| Integration drift between TypeORM and CHECK constraint | Add a spec that attempts CHECK violation and asserts DB error |
