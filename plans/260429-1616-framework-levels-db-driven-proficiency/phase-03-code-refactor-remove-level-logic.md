# Phase 03 — Remove level logic from TypeScript

## Overview
- **Priority:** High
- **Status:** pending
- **Effort:** M
- **Depends on:** Phase 02

## Requirements
- Delete code paths that pick or validate proficiency levels
- DTOs accept optional level (DB fills); responses include shared description
- `LanguageDto.levels[]` sources from DB instead of `LANGUAGE_FRAMEWORKS` constant

## Related Code Files
**Modify:**
- `src/modules/language/language.service.ts` — drop `resolveAndValidateLevel`; query `framework_levels` for level lists & descriptions
- `src/common/guards/language-context.guard.ts` — drop default-pick block at lines 122-130; insert with `proficiency_level: null` so trigger fills
- `src/modules/auth/auth.service.ts` — `bootstrapUserLanguage` insert without `proficiencyLevel`; let trigger fill
- `src/modules/language/dto/user-language.dto.ts` — add optional `description: string` (joined)
- `src/modules/language/dto/language.dto.ts` — change `levels: string[] | null` → `levels: { code: string; description: string }[]`
- `src/database/entities/user-language.entity.ts` — already updated in Phase 02

**Delete (or downgrade to internal-only):**
- `LANGUAGE_FRAMEWORKS` const + `isValidLevel` in `src/common/constants/language-levels.ts` — remove if no remaining consumers, otherwise keep for reference

## Implementation Steps
1. Add `FrameworkLevel` repository injection in `LanguageService`
2. Replace `mapToLanguageDto`'s `levels` computation with a query/cache from `framework_levels` joined by `framework_code = lang.levelFramework`
3. Update `mapToUserLanguageDto` to JOIN/lookup description for the user's level
4. Delete `resolveAndValidateLevel` and its callers (`addUserLanguage`, `updateUserLanguage`)
5. `addUserLanguage`: pass `dto.proficiencyLevel` straight through (may be undefined → trigger picks default; invalid → P0001)
6. `updateUserLanguage`: same
7. Guard `language-context.guard.ts` `autoEnroll`: omit `proficiencyLevel` from create payload entirely
8. Auth `bootstrapUserLanguage`: omit `proficiencyLevel`
9. Search-and-destroy other usages of `LANGUAGE_FRAMEWORKS`
10. Run `npm run build`

## Todo
- [ ] `LanguageService` reads levels from DB
- [ ] `resolveAndValidateLevel` deleted
- [ ] Guard's default-pick logic deleted
- [ ] Auth bootstrap simplified
- [ ] DTOs updated (`UserLanguageDto.description`, `LanguageDto.levels` shape)
- [ ] `LANGUAGE_FRAMEWORKS` const removed (or justified to keep)
- [ ] Build clean

## Success Criteria
- `git grep -E 'LANGUAGE_FRAMEWORKS|resolveAndValidateLevel|isValidLevel'` returns no matches in `src/`
- App boots; `GET /languages` returns levels with descriptions
- `POST /user-languages` without level still creates a row

## Risks
- **Frontend break:** `LanguageDto.levels` shape change. Coordinate with mobile team OR keep both fields temporarily (`levels: string[]` + `levelDescriptions: {code, description}[]`). **Decision needed before merge.**
- Per-row JOIN for description on `mapToUserLanguageDto` — small extra query. Acceptable for MVP; cache later if hot.
