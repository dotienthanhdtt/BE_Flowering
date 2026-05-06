---
title: "Auto-enroll UserLanguage when /lessons called with new X-Learning-Language"
description: "When GET /lessons is called with an X-Learning-Language code the user is not enrolled in, auto-create an inactive UserLanguage row instead of 403, then return lessons filtered by that language. Opt-in per route via @AutoEnrollLanguage() decorator."
status: completed
priority: P1
effort: 1.5h
branch: dev
tags: [language-context, user-language, guards, lessons, backend]
created: 2026-04-20
blockedBy: []
blocks: []
---

# Auto-enroll Language on /lessons

## Summary

Currently `LanguageContextGuard.assertEnrolled()` throws `ForbiddenException('Language "X" not enrolled for this user')` when an authenticated request carries an `X-Learning-Language` code for which the user has no `user_languages` row.

**New behavior (scoped to `/lessons`):** create the `user_languages` row on the fly as **inactive** (do not touch the user's previously-active row), then proceed. All other routes keep the strict 403 behavior — opt-in per controller via `@AutoEnrollLanguage()`.

Users can "browse" a different language's lessons by sending a new header; their primary active language remains whatever they previously set. Explicit activation still goes through `POST /languages/user` or `PATCH /languages/user/:id`.

## Key Decisions (confirmed with user)

- **Opt-in decorator, not global** — `@AutoEnrollLanguage()` applied to `LessonController` only. Other endpoints (AI chat, exercises, progress) keep strict enrollment check.
- **New row is `isActive: false`** — do NOT deactivate the user's existing active language. `request.activeLanguage` still populates from the header for this request's lesson filtering.
- **Validate `isLearningAvailable`** before insert — language must exist, be active, AND be learning-available. Reuses existing check from `LanguageService.addUserLanguage`.
- **Default `proficiencyLevel: BEGINNER`** — matches `ProficiencyLevel` default.
- **Idempotent** — if a row already exists for `{userId, languageId}` (e.g. concurrent requests), skip insert and proceed.
- **Failure-tolerant** — if enrollment insert fails (DB error, race), log a warn and still attach `activeLanguage` so the request doesn't 500. Lessons query tolerates no enrollment row.

## Related Files

### Modify
- `src/common/decorators/active-language.decorator.ts` — add `@AutoEnrollLanguage()` metadata decorator
- `src/common/guards/language-context.guard.ts` — branch `assertEnrolled()` on decorator: auto-create row instead of 403
- `src/common/language-context.module.ts` — inject `Language` repo into guard for `isLearningAvailable` check
- `src/modules/lesson/lesson.controller.ts` — add `@AutoEnrollLanguage()` to class

### Create
- `src/common/guards/language-context.guard.spec.ts` — new test file (none exists today); covers existing + new behavior

### Read-only reference
- `src/database/entities/user-language.entity.ts` — target entity (`ProficiencyLevel` enum)
- `src/database/entities/language.entity.ts` — `isLearningAvailable` flag
- `src/modules/language/language.service.ts` — existing `addUserLanguage()` pattern (lines 106–148)

## Architecture

```
GET /lessons  (X-Learning-Language: fr, user has no fr row)
  ↓ JwtAuthGuard → user attached
  ↓ LanguageContextGuard.canActivate
      1. Resolve header "fr" → { id, code } via cache (existing)
      2. Check user_languages for { userId, languageId }
      3a. Found → proceed (existing)
      3b. NOT found:
          - Read @AutoEnrollLanguage metadata from route/class
          - If absent → ForbiddenException (existing)
          - If present → verify Language.isLearningAvailable → insert
            { userId, languageId, isActive: false, proficiencyLevel: BEGINNER }
            Swallow errors with warn log.
      4. Attach request.activeLanguage = { id, code }
  ↓ LessonController.getLessons
      Service filters by languageId → returns lessons for "fr"
```

## Implementation Steps

### 1. Add `@AutoEnrollLanguage()` decorator

In `src/common/decorators/active-language.decorator.ts` (append):

```ts
export const AUTO_ENROLL_LANGUAGE = 'autoEnrollLanguage';
export const AutoEnrollLanguage = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(AUTO_ENROLL_LANGUAGE, true);
```

### 2. Extend `LanguageContextGuard`

In `src/common/guards/language-context.guard.ts`:

- Inject `Language` repo alongside `UserLanguage`.
- Import `AUTO_ENROLL_LANGUAGE` and `ProficiencyLevel`.
- Replace `assertEnrolled(user.id, lang)` call in `canActivate` with `assertOrAutoEnroll(user.id, lang, context)`:

```ts
private async assertOrAutoEnroll(
  userId: string,
  lang: ActiveLanguageContext,
  context: ExecutionContext,
): Promise<void> {
  const enrolled = await this.userLanguageRepo.findOne({
    where: { userId, languageId: lang.id },
  });
  if (enrolled) return;

  const autoEnroll = this.reflector.getAllAndOverride<boolean>(
    AUTO_ENROLL_LANGUAGE,
    [context.getHandler(), context.getClass()],
  );
  if (!autoEnroll) {
    throw new ForbiddenException(`Language "${lang.code}" not enrolled for this user`);
  }

  await this.autoEnroll(userId, lang);
}

private async autoEnroll(userId: string, lang: ActiveLanguageContext): Promise<void> {
  try {
    const language = await this.languageRepo.findOne({
      where: { id: lang.id, isActive: true, isLearningAvailable: true },
    });
    if (!language) {
      throw new BadRequestException(
        `Language "${lang.code}" is not available for learning`,
      );
    }

    await this.userLanguageRepo.save(
      this.userLanguageRepo.create({
        userId,
        languageId: lang.id,
        isActive: false, // do NOT deactivate user's existing active language
        proficiencyLevel: ProficiencyLevel.BEGINNER,
      }),
    );
    this.logger.log(`Auto-enrolled user ${userId} in language "${lang.code}"`);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    // Unique-constraint race (concurrent requests) or transient failure:
    // if a row now exists, treat as success; otherwise swallow with warn.
    const exists = await this.userLanguageRepo.findOne({
      where: { userId, languageId: lang.id },
    });
    if (!exists) {
      this.logger.warn(
        `Auto-enroll failed for user ${userId}, language "${lang.code}"`,
        error as Error,
      );
    }
  }
}
```

### 3. Update `LanguageContextModule`

Already has `TypeOrmModule.forFeature([Language, UserLanguage])` — `Language` repo is available. No module change needed beyond confirming injection compiles.

### 4. Apply decorator to `LessonController`

In `src/modules/lesson/lesson.controller.ts`:

```ts
import { AutoEnrollLanguage } from '../../common/decorators/active-language.decorator';

@ApiTags('lessons')
@ApiBearerAuth('JWT-auth')
@ApiHeader({ name: 'X-Learning-Language', ... })
@AutoEnrollLanguage()  // ← new
@Controller('lessons')
export class LessonController { ... }
```

### 5. Tests (new file `src/common/guards/language-context.guard.spec.ts`)

Cover — using a mocked `Reflector`, `UserLanguage` repo, `Language` repo, and `LanguageContextCacheService`:

- Existing: header valid + enrolled → attaches context
- Existing: header valid + NOT enrolled + NO auto-enroll metadata → `ForbiddenException`
- Existing: header unknown code → `BadRequestException`
- Existing: no header + authenticated fallback → attaches from `UserLanguage.isActive`
- Existing: no header + anonymous → `BadRequestException`
- Existing: `@Public` / `@SkipLanguageContext` bypass
- **NEW:** header valid + NOT enrolled + auto-enroll metadata + language learning-available → inserts row with `isActive: false`, `proficiencyLevel: BEGINNER`
- **NEW:** auto-enroll target language `isLearningAvailable=false` → `BadRequestException`
- **NEW:** auto-enroll with `{userId, languageId}` already existing (race) → no-op, proceeds
- **NEW:** auto-enroll does NOT deactivate user's other active `user_languages` rows

### 6. Build & run tests

- `npm run build` — verify no TS errors
- `npm test -- language-context.guard` — new spec passes
- `npm test -- src/modules/lesson` — lesson controller regression passes
- `npm test` — full suite green

## Todo

- [x] Add `AUTO_ENROLL_LANGUAGE` constant + `AutoEnrollLanguage()` decorator
- [x] Inject `Language` repo into `LanguageContextGuard`
- [x] Replace `assertEnrolled` with `assertOrAutoEnroll` (+ `autoEnroll` helper)
- [x] Apply `@AutoEnrollLanguage()` to `LessonController`
- [x] Create `language-context.guard.spec.ts` (8+ tests)
- [x] `npm run build` clean
- [x] `npm test` green

## Success Criteria

- [x] Authenticated user sends `GET /lessons` with `X-Learning-Language: <new-code>`:
  - A `user_languages` row is created with `isActive: false` for that language
  - Response returns lessons filtered by that language
  - Previously-active `user_languages` row remains `isActive: true`
- [x] Same request for an already-enrolled language → no new row, lessons returned
- [x] Same request for an unknown/inactive code → `BadRequestException` (unchanged)
- [x] Same request for a code that exists but `isLearningAvailable=false` → `BadRequestException`
- [x] Other protected endpoints (AI chat, exercises) still throw 403 for unenrolled languages (regression guard)
- [x] `npm run build` + `npm test` green
- [x] No DTO or mobile contract changes

## Risk Assessment

- **Unique constraint / race** — two concurrent `/lessons` requests with the same new code could both insert. Mitigation: existing `findOne` pre-check + post-error re-check; DB should have/gain a composite unique `(user_id, language_id)` — verify in `user_languages` DDL, add if missing (out of scope unless absent).
- **Inactive default drift** — if product later decides auto-enrolled should be active, only the `isActive` literal flips; no DTO/API change. Cheap to reverse.
- **Silent enrollment** — user never explicitly asked to enroll; may see unexpected languages in their "learning" list on settings screen. Acceptable per product decision; can be revisited if support complaints arise.
- **Guard complexity creep** — adding business logic (enrollment insert) to a guard. Acceptable for KISS/YAGNI here; if a 3rd opt-in behavior appears, extract a `LanguageEnrollmentService`.

## Security Considerations

- Guard still validates header code against `languages.is_active = true` (existing) → no arbitrary language creation.
- `isLearningAvailable` check blocks enrollment for native-only languages.
- `userId` always taken from JWT-attached `request.user`, never from body/header → IDOR-safe.
- No rate limiting added — `/lessons` already under global rate limits; can't flood insertions faster than login can generate requests.

## Out of Scope

- Making `/exercises`, `/ai-chat`, `/progress` auto-enroll. Revisit only if product asks.
- Auto-activating the new language. Done explicitly via existing endpoints.
- Backfilling `user_languages` for historical users based on past `/lessons` calls.
- Adding a composite unique constraint migration (verify existence first; add only if missing, as a separate micro-migration).

## Next Steps

1. Implement steps 1–4 in a single commit.
2. Run build + tests.
3. Delegate to `code-reviewer` for review.
4. After merge: mobile team optionally pre-loads new language via existing header; no client change required.
