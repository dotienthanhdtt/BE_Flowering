# Phase 4 — Controllers + AI Chat + Onboarding Integration

**Priority:** P0 · **Effort:** 3h · **Status:** complete · **Depends on:** Phase 1, 3

## Context

- Decorator + guard from Phase 1 now work; services from Phase 3 accept `languageId`.
- This phase threads `@ActiveLanguage()` into controllers and resolves the anonymous-onboarding NOT NULL constraint.

## Goal

All language-scoped controllers inject `@ActiveLanguage()` and forward to services. Anonymous onboarding resolves header `code` → `Language.id` and persists on `AiConversation.languageId`. AI chat sources `targetLanguage` from header context instead of body DTO.

## Requirements

### Functional
- FR1: `LessonController.getLessons` injects `@ActiveLanguage() lang` and passes `lang.id` to service
- FR2: `ScenarioChatController.chat` injects `@ActiveLanguage()`; passes `lang.id` to service
- FR3: `AiController.chat` / `streamChat` derive `targetLanguage = lang.code` from header, not DTO (remove `context.targetLanguage` from client responsibility; DTO keeps it optional for backward compat but controller overrides)
- FR4: `OnboardingController` endpoints accept `X-Learning-Language` header (anonymous → required); `OnboardingService.startSession` resolves code → UUID, stores both on `AiConversation` (`languageId` + existing `metadata.targetLanguage`)
- FR5: `/vocabulary` listing endpoint supports optional `?language` filter (defaults to `@ActiveLanguage().code`)
- FR6: Progress/attempt endpoints (if exposed in this phase) inject `@ActiveLanguage()`

### Non-Functional
- DTO validation: add `LanguageCodeHeader` dto-less decorator skip (guard handles validation)
- Swagger: document `X-Learning-Language` header via `@ApiHeader({ name: 'X-Learning-Language', required: true })` on affected controllers

## Related Code Files

### Modify
- `src/modules/lesson/lesson.controller.ts`
- `src/modules/scenario/scenario-chat.controller.ts`
- `src/modules/ai/ai.controller.ts`
- `src/modules/onboarding/onboarding.controller.ts`
- `src/modules/onboarding/onboarding.service.ts` — resolve code → id in `startSession`
- `src/modules/vocabulary/vocabulary.controller.ts` (if exists; else in Phase 3)
- `src/modules/ai/dto/chat-request.dto.ts` — mark `targetLanguage` in `ConversationContext` as deprecated/optional (tolerated but overridden)

### Create
- `src/modules/progress/progress.controller.ts` (if Phase 3 deferred)
- Swagger additions via `@ApiHeader` decorator applied at class level for each

## Implementation Steps

### LessonController
```ts
@Get()
@ApiHeader({ name: 'X-Learning-Language', required: true })
async getLessons(
  @CurrentUser() user: User,
  @ActiveLanguage() lang: ActiveLanguageContext,
  @Query() query: GetLessonsQueryDto,
): Promise<GetLessonsResponseDto> {
  return this.lessonService.getLessons(user.id, lang.id, query);
}
```
Drop `language` query param usage; keep param for admin preview (use when caller supplies override OR active language).

### ScenarioChatController
Add `@ActiveLanguage()`, forward to service.

### AiController (chat + streamChat)
```ts
async chat(
  @CurrentUser() user: User,
  @ActiveLanguage() lang: ActiveLanguageContext,
  @Body() dto: ChatRequestDto,
): Promise<ChatResponseDto> {
  const context = { ...dto.context, targetLanguage: lang.code };
  return this.learningAgent.chat(user.id, dto.message, context, dto.model);
}
```
`checkCorrection` keeps `targetLanguage` in body (OptionalAuth + anonymous path — header should still work; fall back to body if missing).

### OnboardingController + OnboardingService
`@Public()` routes bypass `LanguageContextGuard` (guard short-circuits). Require `X-Learning-Language` explicitly in controller:
```ts
@Public()
@Post('start')
async start(@Headers('x-learning-language') lang: string, @Body() dto: StartDto) {
  if (!lang) throw new BadRequestException('X-Learning-Language header required');
  return this.svc.startSession({ ...dto, targetLanguage: lang });
}
```
`OnboardingService.startSession`:
```ts
const language = await this.languageRepo.findOne({ where: { code: args.targetLanguage, isActive: true } });
if (!language) throw new BadRequestException('Unknown language code');
const conversation = this.conversationRepo.create({
  type: AiConversationType.ANONYMOUS,
  languageId: language.id,
  expiresAt: …,
  metadata: { targetLanguage: args.targetLanguage, nativeLanguage: args.nativeLanguage },
});
```

### Admin authorization placeholder
Phase 5 introduces `AdminGuard`. Apply `@SkipLanguageContext()` if admin routes don't consume active language.

## Todo

- [x] Inject `@ActiveLanguage()` in 4 controllers
- [x] Drop/override `context.targetLanguage` in `AiController` (derive from header)
- [x] Backward-compat: keep body `targetLanguage` as fallback only for `chat/correct` (anonymous)
- [x] Update `OnboardingService.startSession` to resolve + store `languageId`
- [x] Update onboarding tests — mock Language repo
- [x] Update `ChatRequestDto` swagger comment
- [x] `@ApiHeader` applied on LessonController, ScenarioChatController, AiController, VocabularyController
- [x] `npm run build` clean
- [x] `npm test` green (onboarding, lesson, scenario-chat, ai specs)

## Success Criteria

- curl example succeeds: `curl -H "X-Learning-Language: es" -H "Authorization: Bearer ..." /lessons` returns Spanish-only lessons
- Anonymous onboarding start without header → 400; with header → 200 and persisted `ai_conversations.language_id` non-null
- Chat history scoped to active language — sending chat with different header returns no prior history (different languageId)

## Risk Assessment

- **Mobile backward compat** — deploy after mobile client ships header. OR support DB fallback silently during window.
- **Test fixture drift** — any test creating AiConversation without `languageId` breaks. Grep & update.
- **Swagger noise** — `@ApiHeader` per class is explicit; acceptable trade-off.

## Security Considerations

- Anonymous onboarding: validate header value against `languages.is_active = true` inside service (guard skipped on `@Public`).
- Keep `X-Learning-Language` header case-insensitive; strip whitespace; length-capped by HTTP server.

## Next Steps

Phase 5 — admin seeding module leverages the same language context for content creation.
