---
phase: 4
title: "Personalization category stamping"
status: completed
priority: P2
effort: "4h"
dependencies: [2, 3]
---

# Phase 4: Personalization category stamping

## Overview
Personal scenarios are app-stamped with explicit `category_id` at creation. Onboarding-origin → "For you". Trigger-origin (`PersonalizationOfferedEvent` carrying `sourceScenarioId`) → inherit source scenario's `category_id`. DB trigger remains as safety net for any path that forgets.

## Requirements
- Functional: scenarios generated from `/personalization/complete` carry correct `category_id` at INSERT time.
- Functional: trigger flow propagates `sourceScenarioId` from `PersonalizationOfferedEvent` → `ai_conversations.source_scenario_id` → `parseScenarios`.
- Non-functional: no extra DB round-trips per scenario (resolve once per generation batch).

## Architecture

### Onboarding flow
`personalization.service.ts:233 parseScenarios` accepts `categoryId` param. Resolve once:
```ts
const forYouCategory = await this.categoryRepo.findOne({
  where: { languageId, slug: 'for_you', isActive: true },
});
if (!forYouCategory) throw new InternalServerError('Missing for_you category seed');
// pass forYouCategory.id into parseScenarios
```

### Trigger flow
1. `personalization-trigger.service.ts` emits `PersonalizationOfferedEvent(userId, scenarioId)` — already does.
2. Listener that creates the personalization `ai_conversations` row sets `sourceScenarioId = scenarioId`.
3. `completePersonalization` reads `ai_conversations.source_scenario_id`. If set, fetch that scenario, use its `category_id`. Else fall back to `for_you`.

Resolution helper (new):
```ts
private async resolveCategoryId(userId: string, conversationId: string, languageId: string): Promise<string> {
  const convo = await this.conversationRepo.findOne({ where: { id: conversationId, userId } });
  if (convo?.sourceScenarioId) {
    const source = await this.scenarioRepo.findOne({
      where: { id: convo.sourceScenarioId },
      select: ['id', 'categoryId', 'languageId'],
    });
    if (source?.categoryId && source.languageId === languageId) return source.categoryId;
  }
  const forYou = await this.categoryRepo.findOne({
    where: { languageId, slug: 'for_you', isActive: true },
  });
  if (!forYou) throw new InternalServerError(`Missing for_you category for language ${languageId}`);
  return forYou.id;
}
```

## Related Code Files
- Modify: `src/modules/personalization/services/personalization.service.ts`
  - Inject `Repository<ScenarioCategory>`.
  - Add `resolveCategoryId` helper.
  - Update `parseScenarios` signature → accept `categoryId`.
  - Call `resolveCategoryId` once in `completePersonalization` before generation.
- Modify: `src/modules/personalization/services/personalization-engine.service.ts` (if it persists scenarios — verify).
- Modify: `src/modules/personalization/events/personalization-offered.event.ts` — already carries `scenarioId`; verify field name.
- Modify: Wherever `ai_conversations` rows are created for the trigger flow — stamp `sourceScenarioId`. Likely in `personalization.service.ts` or a listener.
- Modify: `src/modules/personalization/personalization.module.ts` — register `ScenarioCategory` repository.

## Implementation Steps
1. Read `personalization.service.ts`, `personalization-trigger.service.ts`, and any `PersonalizationOfferedEvent` listener to map exact call chain.
2. Add `ScenarioCategory` to `TypeOrmModule.forFeature` in personalization module.
3. Implement `resolveCategoryId` helper.
4. Update `parseScenarios` to accept and stamp `categoryId`.
5. Locate `ai_conversations` insert for trigger-offered conversations (or wherever new conversation is created downstream of the event); add `sourceScenarioId` assignment.
6. Run `npm run build`.
7. Run personalization specs: `npm test -- personalization`.
8. Manual e2e on dev: complete a scenario marked `triggers_personalization=true`, complete the offered intake chat, verify generated personal scenarios have `category_id` == source scenario's `category_id`.

## Success Criteria
- [ ] Onboarding-origin personal scenarios land in `for_you` category.
- [ ] Trigger-origin personal scenarios inherit source's `category_id` (manually verified on dev).
- [ ] Trigger-origin where source has no/invalid category falls back to `for_you`.
- [ ] `ai_conversations.source_scenario_id` populated for trigger-flow conversations.
- [ ] Existing personalization specs pass; new spec covers `resolveCategoryId` branches.

## Risk Assessment
- **Risk:** Source scenario in different language than personalization conversation. **Mitigation:** check `source.languageId === languageId` before inherit; fallback to `for_you`.
- **Risk:** `dedup.getRecentPersonalScenarios` returns cached scenarios without category. **Mitigation:** dedup returns existing DB rows that already passed trigger — category guaranteed.
- **Risk:** `parseScenarios` change of signature breaks callers in tests. **Mitigation:** update spec fixtures in same commit.
- **Risk:** `personalization-engine.service.ts` may also build scenarios. **Mitigation:** trace via grep before edits; consolidate stamping in one place.
