# Phase 03 — Service layer refactor

## Context Links
- Depends on: Phase 02 complete (entities + enums available)
- Services: `scenario-access.service.ts`, `lesson.service.ts`, `admin-content.service.ts`
- Related: `scenario-chat.service.ts` (no flag logic inside — just consumes `findAccessibleScenario`; zero changes expected but verify)

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Rewrite query predicates and gate logic to use `status = PUBLISHED` + `accessTier = PREMIUM`. Remove trial-overrides-premium branching. Simplify `computeStatus` to 2 outputs (`AVAILABLE`, `LOCKED`) — `LEARNED` stays reserved for future progress lookup.

## Key Insights
- `findAccessibleScenario` predicate simplifies: `isActive: true` clause removed (status = PUBLISHED already enforces active-ness).
- `assertPremiumAccess` guard becomes `scenario.accessTier === AccessTier.PREMIUM` (single check, no trial escape).
- `lesson.service.ts:buildVisibilityQuery` — remove `scenario.is_active = true` WHERE; keep `status = :published`.
- `lesson.service.ts:computeStatus` collapses to:
  ```
  if (scenario.accessTier === PREMIUM && isFreeUser) return LOCKED
  return AVAILABLE
  ```
- `admin-content.service.ts:whitelistFields`:
  - lessons: `accessTier: item.accessTier === 'premium' ? PREMIUM : FREE`
  - scenarios: same (no `isTrial` branch)
  - Keep whitelist semantics (trust-boundary between LLM JSON and DB write)

## Requirements

### Functional
- `ScenarioAccessService.findAccessibleScenario` uses `{ id, status: PUBLISHED }` (no `isActive`)
- Premium gate: `if (scenario.accessTier === AccessTier.PREMIUM) await assertPremiumAccess(...)`
- `LessonService.buildVisibilityQuery` drops `is_active = true` predicate; keeps `status = 'published'`
- `LessonService.computeStatus` returns only `AVAILABLE | LOCKED` (trial branch removed)
- `AdminContentService.whitelistFields` emits `{ accessTier }` instead of `{ isPremium, isTrial }`

### Non-functional
- Files stay <200 lines (current: access 68, chat 312 — chat is above 200 already but this phase doesn't grow it; out of scope to split)
- No trust of client-supplied flags — `accessTier` in DTOs is whitelisted

## Architecture

### Scenario access decision flow (after)
```
findAccessibleScenario(userId, scenarioId, languageId?):
  scenario ← repo.findOne({ id, status: PUBLISHED }, rel: [category])
  assert languageId match if provided
  if scenario.accessTier === PREMIUM:
     assertPremiumAccess(userId, scenarioId)   // subscription OR explicit grant
  return scenario
```

### Lesson visibility query (after)
```sql
WHERE cat.is_active = true
  AND (scenario.language_id = :languageId OR scenario.id IN user_scenario_access)
  AND scenario.status = 'published'
```
(Note: `cat.is_active` stays — category entity keeps its flag; out of scope.)

## Related Code Files

**Modify:**
- `src/modules/scenario/services/scenario-access.service.ts`
- `src/modules/lesson/lesson.service.ts`
- `src/modules/admin-content/admin-content.service.ts`

**Read-only verify (should require no change):**
- `src/modules/scenario/services/scenario-chat.service.ts` — calls `findAccessibleScenario`; no direct flag access
- `src/modules/scenario/scenario-chat.controller.ts` — passthrough

## Implementation Steps

### scenario-access.service.ts
1. Import `AccessTier` from entities.
2. Line 30–31 replace `where` clause:
   ```ts
   where: { id: scenarioId, status: ContentStatus.PUBLISHED },
   ```
3. Lines 43–46 replace premium gate block:
   ```ts
   if (scenario.accessTier === AccessTier.PREMIUM) {
     await this.assertPremiumAccess(userId, scenarioId);
   }
   ```
4. Remove trial-comment (line 43).

### lesson.service.ts
1. Import `AccessTier`, remove `ScenarioStatus.TRIAL` usage.
2. Line 78 remove `.where('scenario.is_active = true')`; change to `.where('scenario.status = :status', { status: ContentStatus.PUBLISHED })` and drop the later `andWhere('scenario.status = ...')` on line 92.
3. Rewrite `computeStatus` (lines 127–135):
   ```ts
   private computeStatus(scenario: Scenario, isFreeUser: boolean): ScenarioStatus {
     if (scenario.accessTier === AccessTier.PREMIUM && isFreeUser) {
       return ScenarioStatus.LOCKED;
     }
     return ScenarioStatus.AVAILABLE;
   }
   ```

### admin-content.service.ts
1. Import `AccessTier`.
2. In `whitelistFields` (lines 180, 192–197):
   ```ts
   if (type === ContentType.LESSON) {
     return { ...base, accessTier: item.accessTier === 'premium' ? AccessTier.PREMIUM : AccessTier.FREE };
   }
   // scenario
   return {
     ...base,
     accessTier: item.accessTier === 'premium' ? AccessTier.PREMIUM : AccessTier.FREE,
   };
   ```
   (Drops `isPremium`, `isTrial` keys entirely.)

### Final build check
1. Run `npm run build` — expect clean compile.
2. `grep -rn "isPremium\|isTrial" src/modules src/database/entities src/database/seeds` → 0 hits.
3. `grep -rn "isActive" src/modules/{scenario,lesson,admin-content}` → 0 hits (only category / subscription / language references remain elsewhere).

## Todo List
- [x] Update `scenario-access.service.ts`
- [x] Update `lesson.service.ts`
- [x] Update `admin-content.service.ts`
- [x] `npm run build` passes
- [x] `grep` confirms no stale flag refs in modified scope

## Success Criteria
- All three services compile without TS errors
- No remaining references to `isPremium | isTrial | is_active` in modified services
- `scenario-chat.service.ts` requires no edit (dependency only on `findAccessibleScenario` return type)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `scenario-chat.service.ts` indirectly reads `scenario.isPremium` | Low | Med | `grep` confirmed earlier — no such access |
| Lost behavior: trial scenarios previously visible to free users | N/A | None | Product decision: trial collapsed to free — now always visible |
| `admin-content` accepts stale `isPremium` from LLM and silently drops | Med | Low | Phase 04 prompt update aligns LLM output field name |
| `UPDATE` via `updateContent` with `accessTier` not sanitized | Low | Med | Phase 02 DTO adds `@IsEnum(AccessTier)` validation |

## Security Considerations
- Premium gate remains the single source of truth in `scenario-access.service.ts`; no flag-based backdoor (trial override removed).
- AdminContentService continues to whitelist-map LLM output — never pass raw `item` to repo.

## Next Steps
- Phase 04 updates seed data + LLM prompts to emit `accessTier`
- Phase 05 rewrites tests
