# Phase 04 — Onboarding + Intake-Engine + Auth Refactor

## Context Links
- `brainstorm-summary.md`
- `phase-02-entity.md`
- Consumer audit: `auth.service.ts:390`, `onboarding.service.ts:49`, `onboarding.service.ts:67`, `intake-chat-engine.service.ts` (verify in-phase)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Replace `metadata.nativeLanguage` with column read/write. Replace `metadata.targetLanguage` with `languageId`-based lookup of `Language.code`. Touches onboarding flow, the intake chat engine, and auth's onboarding-bootstrap path.

## Key Insights
- `nativeLanguage` cannot be derived (anonymous → no User row). Stored as column `native_language varchar(10)`.
- `targetLanguage` is **derivable** from `conversation.languageId` → `Language.code`. Eager-load via TypeORM `relations: ['language']` to avoid extra round-trips.
- Auth-bootstrap (`auth.service.ts:393`) reads native language code from the conversation; switch to column read.

## Requirements
- Preserve external API contract — `OnboardingChatDto.nativeLanguage` and `targetLanguage` are still client inputs.
- Engine prompt vars (`{ nativeLanguage, targetLanguage }`) unchanged in shape; only the *source* changes.

## Related Code Files
**Modify:**
- `src/modules/onboarding/onboarding.service.ts`
- `src/modules/ai/services/intake-chat-engine.service.ts` (audit only — confirm if it reads `metadata`)
- `src/modules/auth/auth.service.ts` (line 390 region)

**Modify (tests):**
- `src/modules/onboarding/onboarding.service.spec.ts`
- `src/modules/auth/auth.service.spec.ts` (if asserts metadata-bootstrap)

## Implementation Steps

1. **Audit intake-chat-engine.** Open `src/modules/ai/services/intake-chat-engine.service.ts` and grep for `metadata`. Earlier scan showed only `langfuse metadata` (different scope). Confirm: if no `conversation.metadata` access, no changes needed.

2. **`onboarding.service.ts:121-141` — `startSession`**:
   ```ts
   const conversation = this.conversationRepo.create({
     type: AiConversationType.ANONYMOUS,
     title: 'Onboarding Chat',
     languageId: language.id,
     nativeLanguage: args.nativeLanguage, // column, not metadata
   });
   ```
   Drop the `metadata: { nativeLanguage, targetLanguage }` block.

3. **`onboarding.service.ts:42-58` — `handleChat`**:
   ```ts
   const conversation = await this.conversationRepo.findOne({
     where: { id: conversationId },
     relations: ['language'],
   });
   if (!conversation) throw new BadRequestException('Session not found');
   const targetLanguageCode = conversation.language?.code;
   const nativeLanguage = conversation.nativeLanguage;
   if (!targetLanguageCode || !nativeLanguage) {
     throw new BadRequestException('Onboarding session is missing language data');
   }

   const result = await this.engine.runTurn(
     conversationId,
     dto.message,
     { nativeLanguage, targetLanguage: targetLanguageCode },
     onboardingEngineConfig,
   );
   ```

4. **`onboarding.service.ts:65-70` — `complete`**:
   Replace:
   ```ts
   const { targetLanguage } = conversation.metadata as Record<string, string>;
   const language = await this.languageRepo.findOne({ where: { code: targetLanguage } });
   ```
   with:
   ```ts
   const language = conversation.languageId
     ? await this.languageRepo.findOne({ where: { id: conversation.languageId } })
     : null;
   ```
   (Or load `relations: ['language']` on the initial fetch and use `conversation.language` directly.)

5. **`auth.service.ts:388-394`** — replace:
   ```ts
   const meta = conversation.metadata as Record<string, string> | null;
   const nativeLanguageCode = meta?.nativeLanguage;
   ```
   with:
   ```ts
   const nativeLanguageCode = conversation.nativeLanguage;
   ```

6. **Spec: `onboarding.service.spec.ts`** — across ~10 fixtures, replace:
   ```ts
   metadata: { nativeLanguage: 'English', targetLanguage: 'Spanish' }
   ```
   with:
   ```ts
   nativeLanguage: 'English',
   languageId: '<mock-uuid>',
   language: { id: '<mock-uuid>', code: 'Spanish', name: 'Spanish' },
   ```
   Wherever the test exercises `complete()` or `handleChat()`, the mocked `findOne` must return the conversation with `relations: ['language']` shape.

7. **Spec: `auth.service.spec.ts`** — if any test asserts native-language bootstrap, switch fixture from `metadata.nativeLanguage` to `nativeLanguage` column.

8. Run:
   ```bash
   npx tsc --noEmit -p tsconfig.json
   npm test -- onboarding.service.spec
   npm test -- auth.service.spec
   ```

## Todo List
- [ ] Audit `intake-chat-engine.service.ts` for metadata access
- [ ] Refactor `onboarding.service.ts:startSession`
- [ ] Refactor `onboarding.service.ts:handleChat` (load with relations)
- [ ] Refactor `onboarding.service.ts:complete`
- [ ] Refactor `auth.service.ts` bootstrap
- [ ] Update onboarding spec fixtures (~10 blocks)
- [ ] Update auth spec fixtures (if needed)
- [ ] Run affected specs

## Success Criteria
- No `conversation.metadata` references in onboarding, intake-engine, or auth.
- Onboarding flow end-to-end: start → chat → complete works with new schema.
- Auth bootstrap successfully sets `User.nativeLanguage` after Firebase login that links an onboarding conversation.

## Risk Assessment
- **Eager-load N+1** — using `relations: ['language']` on every `findOne` adds one join. Cost: 1 extra `JOIN`, no extra round-trip. Acceptable.
- **Mock churn** — onboarding spec has many fixtures; missing one will produce TS errors immediately.

## Security Considerations
None.

## Next Steps
Phase 05 — full test sweep + smoke verification.
