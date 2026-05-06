# Phase 3 — Service Layer Filtering

**Priority:** P0 · **Effort:** 4h · **Status:** complete · **Depends on:** Phase 2

## Context

- All learning content services currently ignore language when reading user-scoped data (progress, attempts). Migrations from Phase 2 give us the columns; this phase wires them into service queries.
- Services to update: `LessonService`, `ScenarioChatService`, `LearningAgentService` (history scoping), `TranslationService` (for history isolation if tied to conversations), plus any new progress/exercise services.
- **IMPORTANT**: The current `LessonService` already accepts `language` query param and filters. Refactor to take `languageId` from decorator instead of DTO for internal calls; keep DTO param for admin / future filter override.

## Goal

Every read/write of language-scoped data includes `WHERE language_id = :activeLang`. No cross-language data leakage possible. Services receive `languageId` as an explicit argument from controllers (not extracted inside the service).

## Key Insights

- Keep **pure services** — don't have services call `ActiveLanguage()` themselves. Inject `languageId: string` as a parameter. Easier to test; controller owns request-scoped context.
- `UserLanguage.isActive` flag still matters: when user toggles learning language, mobile also switches the header. The `LanguageContextGuard` uses this only as fallback.
- For shared data (e.g. `/vocabulary`) — Vocabulary uses `sourceLang/targetLang` strings, not `languageId`. **Scope**: vocab queries should optionally filter `targetLang = activeLang.code`. Decide per-endpoint.

## Requirements

### Functional
- FR1: `LessonService.getLessons` accepts `languageId: string` + DTO overrides. Scenario visibility query uses `scenario.language_id = :languageId`.
- FR2: A new `ExerciseService` (if needed) or existing exercise lookup filters by `languageId`.
- FR3: A new `UserProgressService` (or existing controller logic) queries `user_progress` with `userId + languageId`.
- FR4: A new `UserExerciseAttemptService` (or inline queries) writes `languageId` on insert.
- FR5: `ScenarioChatService.chat` reads `scenario` via `scenario.id AND scenario.language_id = :languageId` (prevents scenario/language mismatch).
- FR6: `LearningAgentService` fetches conversation history filtered by `conversation.language_id = :languageId`.
- FR7: `Vocabulary` queries: optionally filter `targetLang = activeLang.code` when listing per-language. Leave CRUD unchanged, add optional `?language` filter to listing.

### Non-Functional
- No new N+1 queries — use `languageId` in same WHERE clauses, not subselects.
- Existing unit tests updated; new tests for each filtered path.

## Related Code Files

### Modify
- `src/modules/lesson/lesson.service.ts` — change signature, drop NULL-language branch, enforce required `languageId`
- `src/modules/lesson/dto/get-lessons-query.dto.ts` — mark `language` optional; document that `@ActiveLanguage()` wins when both present (controller passes one)
- `src/modules/scenario/services/scenario-chat.service.ts` — add `languageId` guard on scenario fetch + conversation find-or-create
- `src/modules/scenario/services/scenario-access.service.ts` — verify scenario belongs to active language
- `src/modules/ai/services/learning-agent.service.ts` — add `languageId` to conversation find / create / history queries
- `src/modules/ai/services/translation.service.ts` — ensure AiConversation is created with `languageId`
- `src/modules/vocabulary/vocabulary.service.ts` — add optional filter

### Create
- `src/modules/progress/progress.module.ts`
- `src/modules/progress/progress.service.ts` — read/write UserProgress + UserExerciseAttempt with languageId
- `src/modules/progress/progress.controller.ts` (deferred to Phase 4 if scope allows)
- Unit specs for above

## Implementation Steps

### LessonService
```ts
async getLessons(userId: string, languageId: string, query: GetLessonsQueryDto): Promise<GetLessonsResponseDto> {
  const qb = this.scenarioRepo.createQueryBuilder('scenario')
    .innerJoin('scenario.category', 'cat', 'cat.is_active = true')
    .where('scenario.is_active = true')
    .andWhere('scenario.language_id = :languageId', { languageId });
  // … existing filters (level, search) …
}
```
Remove the `scenario.language_id IS NULL OR …` branch (no globals).

### ScenarioChatService (verify)
Grep service for `scenarioRepo.findOne` — must include `language_id`:
```ts
const scenario = await this.scenarioRepo.findOne({ where: { id, languageId, isActive: true } });
if (!scenario) throw new NotFoundException('Scenario not available for active language');
```
Conversation find-or-create keyed by `(userId, scenarioId, languageId)`.

### LearningAgentService
- `getConversationHistory` filter includes `languageId` (if conversations ever leaked it wouldn't compile now that column is required).
- On new conversation create: pass `languageId`.

### ProgressService (new, minimal)
```ts
async upsertProgress(userId: string, languageId: string, lessonId: string, patch: Partial<UserProgress>) {
  const existing = await this.repo.findOne({ where: { userId, lessonId } }); // unique(user,lesson)
  if (existing && existing.languageId !== languageId) throw new ForbiddenException();
  // upsert with languageId
}

async recordAttempt(userId: string, languageId: string, exerciseId: string, answer, result) {
  await this.attemptRepo.insert({ userId, languageId, exerciseId, userAnswer: answer, isCorrect: result.correct, pointsEarned: result.points });
}
```

### Vocabulary (optional filter)
`GET /vocabulary?language=en` → filter by `targetLang = :code`. Otherwise return all.

## Todo

- [x] Refactor `LessonService` signature (`userId, languageId, query`)
- [x] Update `LessonController` call sites (Phase 4 owns controller)
- [x] Create `progress.module.ts` + `progress.service.ts`
- [x] Update `ScenarioChatService` scenario fetch + conversation keying
- [x] Update `LearningAgentService` conversation queries
- [x] Update `TranslationService` conversation create path (set languageId)
- [x] Update `VocabularyService` list endpoint filter
- [x] Fix existing service specs; add new cases for language scoping
- [x] `npm run build` clean
- [x] `npm test -- src/modules/{lesson,scenario,ai,vocabulary,progress}` green

## Success Criteria

- Every service that reads language-partitioned data requires an explicit `languageId: string` parameter
- Cross-language access attempt (e.g., user with `es` active trying to load Spanish scenario via English content) throws `NotFoundException` (data-level isolation)
- Tests cover: happy path, wrong language → 404, missing language param → type error at compile time

## Risk Assessment

- **Shadow usages** — grep `scenarioRepo\.find`, `conversationRepo\.find`, `progressRepo\.` across modules; any unfiltered call is a leak.
- **Existing tests** — fixtures may create records without `languageId`. Now required — update fixture builders.
- **Scenario-chat resume break** — active conversations keyed only on `(userId, scenarioId)` currently. After migration they carry `languageId`; resume still works because scenarioId implies languageId (scenarios are per-language).

## Security Considerations

- Prevents **horizontal privilege escalation** across languages (e.g., free user with `en` active cannot read `es` premium scenarios).
- No additional authN needed — authZ enforced via `languageId` filter.

## Next Steps

Phase 4 — controllers wire `@ActiveLanguage()` to service calls and handle anonymous onboarding.
