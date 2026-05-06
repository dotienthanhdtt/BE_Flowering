---
title: "Bootstrap UserLanguage from onboarding on first auth"
description: "When a user registers/logs in with a conversationId from anonymous onboarding, auto-create a UserLanguage row from AiConversation.languageId (idempotent — skip if row already exists for same language)."
status: completed
priority: P1
effort: 1.5h
branch: dev
tags: [auth, onboarding, user-language, backend]
created: 2026-04-19
completed: 2026-04-19
blockedBy: []
blocks: []
---

# Bootstrap UserLanguage from Onboarding

## Summary

After anonymous onboarding, when the user authenticates with `conversationId`, the backend already links the `AiConversation` via `AuthService.linkOnboardingSession()`. **Extend that method** to also create a `UserLanguage` row for the user using the `AiConversation.languageId` — making the onboarding target language immediately active, with zero extra mobile calls.

**Idempotency required:** if the user already has a `UserLanguage` row for that same language, do not duplicate — just ensure it's the active one.

## Context

- Phase 2 of `260418-2238-multi-language-content-architecture` made `AiConversation.languageId` NOT NULL. Every onboarding conversation already owns a language.
- `LanguageService.updateUserLanguage` and `addUserLanguage` now enforce mutual exclusivity on `isActive` (fixed 2026-04-19).
- Auth service passes `conversationId` through `register`, `login`, and `firebaseLogin` via existing DTOs — already in the contract, no frontend change needed.
- Only missing piece: the `linkOnboardingSession` private method only links the conversation; it doesn't touch `user_languages`.

## Key Decisions

- **No DTO / controller changes.** Reuse existing `conversationId` field in auth DTOs.
- **Idempotent by design.** Check `user_languages` for `{userId, languageId}` before insert.
- **Always set active** after successful bootstrap (auto-deactivates others). New users have zero existing rows so this is a no-op for their first auth; returning users get their onboarding-selected language reactivated.
- **Failure-tolerant.** Wrap in try/catch with warn log — do NOT fail authentication if language bootstrap fails (same pattern as existing `linkOnboardingSession` error handling).

## Related Files

### Modify
- `src/modules/auth/auth.service.ts` — extend `linkOnboardingSession()`
- `src/modules/auth/auth.module.ts` — add `UserLanguage` to `TypeOrmModule.forFeature()`
- `src/modules/auth/auth.service.spec.ts` — add tests

### Read-only reference
- `src/database/entities/ai-conversation.entity.ts` — has `languageId` since Phase 2
- `src/database/entities/user-language.entity.ts` — target entity
- `src/modules/language/language.service.ts` — pattern for deactivation (lines 129–145)

## Implementation Steps

### 1. Inject `UserLanguage` repository into `AuthService`
```ts
@InjectRepository(UserLanguage)
private readonly userLanguageRepo: Repository<UserLanguage>,
```
Add `UserLanguage` to `AuthModule.TypeOrmModule.forFeature([...])`.

### 2. Extend `linkOnboardingSession` to bootstrap language

```ts
private async linkOnboardingSession(userId: string, conversationId: string): Promise<void> {
  try {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, type: AiConversationType.ANONYMOUS },
    });
    if (!conversation) {
      this.logger.warn(`No anonymous onboarding session found for id: ${conversationId}`);
      return;
    }

    // 1. Link conversation → user (existing behavior)
    await this.conversationRepository.update(
      { id: conversationId, type: AiConversationType.ANONYMOUS },
      { userId, type: AiConversationType.AUTHENTICATED },
    );

    // 2. Bootstrap user_languages from conversation.languageId (idempotent)
    await this.bootstrapUserLanguage(userId, conversation.languageId);
  } catch (error) {
    this.logger.warn('Failed to link onboarding session', { conversationId, error });
  }
}

private async bootstrapUserLanguage(userId: string, languageId: string): Promise<void> {
  const existing = await this.userLanguageRepo.findOne({ where: { userId, languageId } });

  // Deactivate all currently-active rows (mutual exclusivity)
  await this.userLanguageRepo.update({ userId, isActive: true }, { isActive: false });

  if (existing) {
    // Row exists — just flip it active
    await this.userLanguageRepo.update(existing.id, { isActive: true });
  } else {
    // New row — create as active with default proficiency
    await this.userLanguageRepo.save(
      this.userLanguageRepo.create({ userId, languageId, isActive: true }),
    );
  }
}
```

### 3. Tests to add in `auth.service.spec.ts`

- ✅ `firebaseLogin` with `conversationId` creates a `UserLanguage` row when user has none
- ✅ `firebaseLogin` with `conversationId` skips insert but reactivates row when `{userId, languageId}` already exists
- ✅ `firebaseLogin` with `conversationId` deactivates previously-active language for that user
- ✅ Auth still succeeds when `linkOnboardingSession` throws (error swallowed)
- ✅ `conversationId` not provided → no `UserLanguage` call at all (`register`/`login`/`firebaseLogin`)

## Success Criteria

- [x] User completes anonymous onboarding → registers → `user_languages` row exists with `isActive: true` matching onboarding `targetLanguage`
- [x] Same user repeats the flow with a different onboarding session → old row deactivated, new language row active
- [x] User with pre-existing active language re-authenticates with onboarding conversationId for that same language → no duplicate, isActive remains true
- [x] Auth still succeeds when anonymous session was expired/deleted before linking
- [x] `npm test` green, `npm run build` clean
- [x] No changes to API DTOs or mobile contract

## Risk Assessment

- **Double-active rows** — prevented by explicit `update({ userId, isActive: true }, { isActive: false })` before flipping target to active.
- **Linking failure blocking auth** — prevented by outer try/catch (existing pattern).
- **Race: user logs in twice concurrently with same conversationId** — second call finds the row already reassigned (`type=AUTHENTICATED`), falls into `affected === 0` branch which now warns but already deactivates others inappropriately. **Mitigation:** only call `bootstrapUserLanguage` if the conversation was successfully loaded with `type=ANONYMOUS` — if reassignment already happened, skip.

## Out of Scope

- Adding `targetLanguage` to auth DTOs as a direct field (overlap with conversation-based linking)
- Multi-language onboarding (one onboarding = one language — enforced at DB level)
- Retroactive backfill for users whose onboarding session was linked before this change (manual SQL if ever needed)

## Next Steps

After merge:
1. Remove the line from mobile adaptation requirements doc that says mobile must call `POST /languages/user` after registration if `conversationId` was sent.
2. Keep `POST /languages/user` for users adding subsequent languages in settings.
