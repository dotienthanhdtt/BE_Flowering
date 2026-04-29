# Phase 06 — Code refactor for per-language framework levels

## Overview
- **Priority:** Critical
- **Status:** pending
- **Effort:** M
- **Depends on:** Phase 05

## Requirements
- Entity, cache service, services, validator, onboarding all key by `language_id`
- `language.entity.ts` no longer carries `levelFramework`
- DTO shape unchanged (`LanguageDto.levels: {code, description}[]`)
- All affected tests updated; build + tests green

## Related Code Files
**Modify:**
- `src/database/entities/framework-level.entity.ts` — composite PK `(languageId, levelCode)`, add `frameworkCode` column
- `src/database/entities/language.entity.ts` — drop `levelFramework` field
- `src/common/services/framework-levels.service.ts` — cache keyed by `languageId`; expose `getLevels(languageId)`, `getDescription(languageId, level)`, `getFrameworkCode(languageId)`
- `src/modules/language/language.service.ts` — `mapToLanguageDto` keys by `lang.id`; `onModuleInit` no longer queries `level_framework` (column gone) — drop or replace with framework_levels presence check
- `src/modules/auth/auth.service.ts` — same mapping shift (`getUserLanguages`)
- `src/common/validators/is-valid-level-for-language.validator.ts` — validate by `language_id` directly; drop `level_framework` lookup
- `src/modules/onboarding/onboarding.service.ts` — resolve framework via `frameworkLevels.getFrameworkCode(languageId)` instead of `language.levelFramework`
- `src/database/seeds/language-seed-data.ts` — drop `levelFramework` field; seed query drops `level_framework` column writes

**Update tests:**
- `src/modules/language/language.service.spec.ts` — fixture `mockLang` drops `levelFramework`; `FrameworkLevelsService` mock returns levels keyed by language
- `src/common/guards/language-context.guard.spec.ts` — drop `levelFramework` from fixture languages
- `src/modules/onboarding/onboarding.service.spec.ts` — mock `getFrameworkCode`
- `src/modules/auth/auth.service.spec.ts` — already mocks `FrameworkLevelsService`; no changes expected
- `src/common/constants/language-levels.spec.ts` — unchanged (pure mapping fn)

## Implementation Steps

1. **Entity**
   ```ts
   @Entity('framework_levels')
   export class FrameworkLevel {
     @PrimaryColumn({ type: 'uuid', name: 'language_id' }) languageId!: string;
     @PrimaryColumn({ type: 'varchar', length: 16, name: 'level_code' }) levelCode!: string;
     @Column({ type: 'varchar', length: 16, name: 'framework_code' }) frameworkCode!: string;
     @Column({ type: 'text' }) description!: string;
     @Column({ type: 'int', name: 'order_index' }) orderIndex!: number;
   }
   ```

2. **`FrameworkLevelsService`** — restructure cache:
   ```ts
   private byLanguage = new Map<string, { frameworkCode: string; levels: FrameworkLevelDescriptor[] }>();
   private byKey = new Map<string, string>(); // `${languageId}:${levelCode}` -> description

   getLevels(languageId: string | null | undefined): FrameworkLevelDescriptor[] { ... }
   getDescription(languageId, levelCode): string { ... }
   getFrameworkCode(languageId): string | null { ... }
   ```

3. **`Language` entity** — remove `levelFramework` column declaration.

4. **`LanguageService`**
   - `onModuleInit`: replace null-check loop with "every active learning language must have framework_levels rows" check via `FrameworkLevelsService.getLevels(lang.id).length > 0`.
   - `mapToLanguageDto(lang)`: `levels: this.frameworkLevels.getLevels(lang.id)`.
   - `mapToUserLanguageDto(ul)`: `description: this.frameworkLevels.getDescription(ul.languageId, level)`.

5. **`AuthService.getUserLanguages`** — same: drop `levelFramework` ref, key everything by `ul.languageId`.

6. **Validator** — `IsValidLevelForLanguageConstraint.validate`:
   ```ts
   const exists = await this.dataSource.getRepository(FrameworkLevel).findOne({
     where: { languageId, levelCode: value },
   });
   return !!exists;
   ```
   No more `Language` lookup needed.

7. **Onboarding** — `mapOnboardingLevel` reads framework via cache:
   ```ts
   private mapOnboardingLevel(languageId: string, suggestion: string | undefined): string {
     const framework = this.frameworkLevels.getFrameworkCode(languageId);
     // ... rest as today, using `framework` string
   }
   ```
   Update callers to pass `languageId` instead of `framework`.

8. **Seeds** — `language-seed-data.ts`: drop `levelFramework` field & column from query; rely on `framework_levels` for that knowledge going forward.

9. **Build** — `npm run build`; fix any leftover `levelFramework` references.

10. **Tests** — `npm test`; adjust fixtures that read `mockLang.levelFramework`.

## Todo
- [ ] Entity restructured
- [ ] `FrameworkLevelsService` cache rebuilt by `languageId`
- [ ] `Language` entity drops `levelFramework`
- [ ] `LanguageService` mapping & onModuleInit updated
- [ ] `AuthService.getUserLanguages` mapping updated
- [ ] Validator queries by `languageId`
- [ ] Onboarding uses `getFrameworkCode(languageId)`
- [ ] Seed data updated
- [ ] All tests pass
- [ ] Build clean

## Success Criteria
- `git grep "levelFramework"` returns zero matches in `src/` (except the ignored old migration files)
- `npm test` green for affected suites
- Manual smoke (after Phase 05 migration runs):
  - `GET /languages` returns each language with its own `levels[]`
  - `POST /languages/me { languageId: '<en>' }` (no level) returns `proficiencyLevel: 'A1'`
  - `PATCH /languages/me/<en> { proficiencyLevel: 'N3' }` returns 400 with trigger message

## Risks
- **`languages.level_framework` removal touches seed data** — if dev re-runs seeds against an older DB, the seed query must not write `level_framework`. Confirm seeds run after migrations in your local flow.
- **Onboarding caller signature change** — `mapOnboardingLevel` switches from `(framework, suggestion)` to `(languageId, suggestion)`. Find every caller and update; test coverage will catch missed ones.
- **Validator drops `Language` lookup** — minor: previously short-circuited "frameworkless → accept anything". Now validator returns false for any level not in framework_levels for that language. FRAMEWORKLESS langs (vi/th) only have row `'beginner'`, so any other input → 400. That's the *right* behavior post-refactor; flag for FE if any code sent arbitrary strings for vi/th.
