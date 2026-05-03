# Phase 05 — De-Dup Gate

## Context Links
- Brainstorm §5.5
- Phase 01 (`lastPersonalizationAt`, `personalizationProfileSnapshot`)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Skip expensive scenario generation if last fire <24h ago AND extracted profile has no new keys/values vs. snapshot. Return prior batch instead.

## Key Insights
- Two cumulative conditions required to skip — either alone is insufficient.
- "No new fields" = top-level key set diff + value equality (per scope discipline).
- Extraction LLM call still happens (can't diff without it). Generation call is what we save (~1024 tokens).

## Requirements
**Functional:**
- `shouldSkipGeneration(user, freshProfile) → bool`
- `getRecentPersonalScenarios(userId, limit=5) → Scenario[]` (returns previous batch when skipping).
- Snapshot update happens after successful generation only (not on skip).

**Non-Functional:**
- Diff is pure JS, <1ms.
- Recent-scenarios fetch uses indexed query.

## Architecture
```
PersonalizationDedupService
  ├── shouldSkipGeneration(user, profile): bool
  ├── computeProfileDiff(snapshot, fresh): { hasNew: bool, addedKeys: string[] }
  └── getRecentPersonalScenarios(userId): Scenario[]
```

## Related Code Files
**Modify:**
- `src/modules/personalization/personalization.service.ts` — call dedup before generation
- `src/modules/personalization/personalization.module.ts` — provide service

**Create:**
- `src/modules/personalization/services/personalization-dedup.service.ts`

**Delete:** none

## Implementation Steps
1. Implement `computeProfileDiff(snapshot, fresh)`:
   - if snapshot null → `{hasNew:true}` (always generate first time).
   - else compare top-level keys; for shared keys, compare value equality (deep equal via `JSON.stringify` for v1).
   - return added keys.
2. Implement `shouldSkipGeneration`:
   - if `lastPersonalizationAt` null OR older than 24h → false (don't skip).
   - else check diff; if no new → true (skip).
3. Wire into `PersonalizationService.complete()` AFTER extraction, BEFORE generation:
   - if skip: fetch recent scenarios via `getRecentPersonalScenarios`, return `{scenarios, generatedNew: false}`.
   - else: generate, persist, update snapshot + `lastPersonalizationAt`.
4. Increment "dedup_skip" counter (Phase 10).
5. `npm run build`.

## Todo List
- [ ] Diff util
- [ ] Skip decision
- [ ] Recent scenarios fetch
- [ ] Wire into complete()
- [ ] Update snapshot only on generation
- [ ] Build clean

## Success Criteria
- First-ever call: never skips.
- Same profile within 24h: skips, returns prior batch, response `generatedNew=false`.
- New key in profile within 24h: does NOT skip (generates fresh).
- Same profile after 25h: does NOT skip.

## Risk Assessment
- **Value equality too strict** → telemetry (Phase 10) tracks skip rate; if <10% revisit to "key-set diff only".
- **Snapshot becomes stale forever if user never generates** → snapshot only ever overwritten, not appended; v1 acceptable.
- **JSON.stringify key-order non-determinism** → use sorted-keys serializer if needed.

## Security Considerations
- None new (snapshot is user-owned).

## Next Steps
- Parallel with Phase 04. Phase 06 trigger pre-checks dedup BEFORE intake to avoid even starting chat (optional optimization; v1 only checks at /complete).
