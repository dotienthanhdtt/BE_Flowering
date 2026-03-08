# Code Review: Translate Word & Sentence Feature

**Date:** 2026-03-08
**Branch:** feat/translate-word-sentence
**Score: 8.5/10**

---

## Scope

- Files reviewed: 11 (6 new, 5 modified)
- Review focus: Security, error handling, NestJS patterns, entity/migration consistency, DTO validation
- Build: PASS (`npm run build`)
- Tests: 11/11 PASS (`jest translation.service`)
- Lint: Pre-existing errors only (no new errors from these files; spec file has same TSConfig exclusion issue as other spec files in project)

---

## Overall Assessment

Solid, production-quality implementation. Security model is correct (ownership check via ForbiddenException, RLS policy, JWT guard inherited from controller). Build is clean, tests are comprehensive (11 cases covering cache hit/miss, auth failure, JSON parse fallback). Minor issues below, none blocking.

---

## Critical Issues

None.

---

## High Priority Findings

### 1. Prompt injection risk (word translation)
**File:** `src/modules/ai/prompts/translate-word.md`
The `{{word}}` value comes directly from user input and is interpolated into the prompt string. A user could send `word = "hello" IGNORE PREVIOUS INSTRUCTIONS AND...` to attempt prompt injection. The DTO enforces `@MaxLength(255)` which limits damage, but offers no structural containment.
**Fix:** Consider wrapping the substituted value in a system boundary or using a structured message (separate system/user messages) rather than a single-string prompt. Low severity given the constrained use case (translation only), but worth noting.

### 2. Spec file tests the `MockTranslationService`, not `TranslationService`
**File:** `src/modules/ai/services/translation.service.spec.ts`
The spec duplicates the entire service implementation as `MockTranslationService` and tests that copy instead of the actual service. If the real service has a bug, these tests won't catch it.
**Recommendation:** Replace with standard NestJS `TestingModule` approach — inject mocked repositories/services and instantiate the real `TranslationService`. This is a meaningful gap in test quality.

---

## Medium Priority Improvements

### 3. Missing `@IsNotEmpty()` on conditional fields
**File:** `src/modules/ai/dto/translate-request.dto.ts`
`@ValidateIf(o => o.type === WORD) @IsString() @MaxLength(255) text?` — an empty string `""` passes `@IsString()` but is meaningless. Same for `messageId`. Add `@IsNotEmpty()` under `@ValidateIf` for both.

### 4. `translateWord` upsert has a race condition window
**File:** `src/modules/ai/services/translation.service.ts` (lines 58–80)
The findOne → save pattern is not atomic. Two concurrent requests for the same user/word/lang combo can both get `null` from `findOne` and both attempt `create`, hitting the UNIQUE constraint. This throws a DB error that propagates as a 500.
**Fix:** Use `INSERT ... ON CONFLICT DO UPDATE` via `queryRunner` or `createQueryBuilder().insert().orUpdate(...)`. Alternatively, wrap in try/catch and handle the unique constraint error by re-fetching.

### 5. `AiConversation.userId` is nullable
**File:** `src/database/entities/ai-conversation.entity.ts` (line 28)
`userId?: string | null`. The ownership check in `translateSentence` is:
```ts
if (message.conversation.userId !== userId)
```
If `conversation.userId` is `null` (anonymous conversation), this evaluates to `null !== 'real-uuid'` = `true`, so it throws `ForbiddenException` — which is correct behavior. But the logic is implicit. Add a null-guard for clarity:
```ts
if (!message.conversation.userId || message.conversation.userId !== userId)
```

### 6. `sentence` template variable injection risk via `message.content`
**File:** `src/modules/ai/services/translation.service.ts` (line 124)
`message.content` (AI-generated or user-written) is substituted into the prompt template as `{{sentence}}`. Same prompt injection concern as #1, compounded by the fact that `message.content` is not user-controlled at the point of injection — but it could contain LLM-generated content with injected instructions.

---

## Low Priority Suggestions

### 7. Migration timestamp is in the past
`1740300000000` = Feb 23, 2025. The convention is to use current Unix ms timestamp when generating migrations. This could cause ordering issues if other migrations run between now and when this was notionally created. Not a functional bug if run fresh, but inconsistent.

### 8. `translate` controller method has no explicit response type
**File:** `src/modules/ai/ai.controller.ts` (line 160)
`async translate(...) { ... }` returns `any`. Define a union response type or a `TranslateResponseDto` for Swagger + type safety. The `@ApiResponse({ status: 200, description: '...' })` without a `type:` field means Swagger schema is empty.

### 9. Lint error for spec file (pre-existing pattern)
The spec file has the same `parserOptions.project` TSConfig exclusion issue as `onboarding.service.spec.ts`. Not introduced by this PR but worth fixing project-wide.

---

## Positive Observations

- **Security model is correct**: ownership verification via `conversation.userId` before accessing message content; `ForbiddenException` vs `NotFoundException` distinction maintained properly.
- **RLS policy in migration**: good defensive depth — DB-level isolation in addition to app-level checks.
- **LLM JSON parse fallback chain**: try direct parse → regex extract → raw string fallback. Graceful degradation.
- **Cache hit short-circuit**: sentence translation skips LLM call when `translatedLang` matches. Correct and efficient.
- **`@ValidateIf` conditional validation**: correctly scoped, using `ValidateIf` rather than manual controller checks — clean NestJS pattern.
- **Module registration**: Vocabulary entity properly added to `TypeOrmModule.forFeature`, `TranslationService` properly exported.
- **Prompt files in assets**: project already has `nest-cli` assets config to copy `.md` files to dist (per recent commit `523e312`).
- **Build is clean**: zero TS errors.

---

## Recommended Actions

1. **[High]** Rewrite `translation.service.spec.ts` to use real `TranslationService` with mocked dependencies via `TestingModule`.
2. **[Medium]** Add `@IsNotEmpty()` to `text` and `messageId` conditional validators in DTO.
3. **[Medium]** Handle UNIQUE constraint race condition in `translateWord` — either use `INSERT ... ON CONFLICT` or catch the constraint violation error.
4. **[Low]** Add null-guard for anonymous conversations in `translateSentence` ownership check.
5. **[Low]** Define `TranslateResponseDto` or union type for Swagger and type safety on the controller method.

---

## Metrics

- Type Coverage: Strong (only `any` in spec file, which is expected for mocks)
- Test Coverage: 11 unit tests; gap: tests cover MockTranslationService copy, not real service
- Linting Issues: 0 new errors introduced; 14 pre-existing errors in project (unrelated files)
- Build: Clean

---

## Unresolved Questions

- Should sentence cache support multiple target languages? Currently only the most recently cached language is stored (single `translated_lang` column). Translating the same message to `es` then `fr` overwrites the `es` cache. This may be intentional given the schema design.
- Is `GEMINI_2_0_FLASH` always available in all environments? No fallback model is specified for translation unlike other AI endpoints.
