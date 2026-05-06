# Phase 4 — Seed Data + Service Validation Wiring

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §6
- Seed file: `src/database/seeds/language-seed-data.ts`
- Service: `src/modules/language/language.service.ts`

## Overview
- Priority: P1
- Status: completed
- Effort: 45m
- Brief: Add `levelFramework` to seed rows (fresh DBs). Wire `language.service.ts` to apply default + validate levels against framework on `addUserLanguage` / `updateUserLanguage`. Add boot-time seed invariant (learning-available ⇒ framework set).

## Key Insights
- Seed + migration must agree: fresh DB from seed should land in same state as migrated DB.
- Service-layer validation is defense-in-depth (validator in DTO is first line).
- Invariant check throws on boot to catch seed drift early (brainstorm §9 mitigation).

## Requirements

**Functional**
- `language-seed-data.ts`: every entry gains `levelFramework` field. Map per brainstorm: en/es/fr/de/pt=CEFR, ja=JLPT, zh=HSK, ko=TOPIK, vi=null, th=null.
- `language.service.ts`:
  - `addUserLanguage(userId, dto)`: fetch language; if `dto.proficiencyLevel` omitted → default to `LANGUAGE_FRAMEWORKS[framework][0]` (or `'beginner'` if framework null); else validate `isValidLevel(framework, dto.proficiencyLevel)` and throw `BadRequestException` if invalid
  - `updateUserLanguage`: same validation when `proficiencyLevel` present
  - Preserve existing "single active language" rule unchanged
- Seed invariant: after seeding or on service init, verify `SELECT code FROM languages WHERE is_learning_available=true AND level_framework IS NULL` returns zero matches for en/es/fr/de/pt/ja/zh/ko. (vi/th intentionally null.)

**Non-functional**
- No new module / no DI graph changes.
- Service file stays under 200 lines (split helpers if needed).

## Architecture
Service imports `isValidLevel`, `LANGUAGE_FRAMEWORKS` from phase 1 registry. Seed invariant is a small private method called once in `LanguageService.onModuleInit()` (warn-only log, not throw — avoid prod crash on mislabeled extra language; throw only in non-production).

## Related Code Files

**Modify**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/database/seeds/language-seed-data.ts` — add `levelFramework` per row
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/language.service.ts` — validation wiring + invariant check
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/language.service.spec.ts` — add validation cases

## Implementation Steps

1. Update seed type/interface if typed; add `levelFramework: 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK' | null` to each of 10 entries.
2. In `language.service.ts`:
   - Import `{ isValidLevel, LANGUAGE_FRAMEWORKS, FrameworkCode }` from `@common/constants/language-levels`
   - Add private helper `resolveDefaultLevel(framework: string | null): string` returning `framework ? LANGUAGE_FRAMEWORKS[framework][0] : 'beginner'`
   - In `addUserLanguage`: after fetching language, if dto has no level use default; otherwise validate
   - In `updateUserLanguage`: when dto has proficiencyLevel, re-fetch language (or pass down) → validate
   - Throw `BadRequestException(\`Invalid level '\${level}' for \${language.code}. Valid: \${valid.join(', ')}\`)`
3. Implement `OnModuleInit`:
   ```ts
   async onModuleInit() {
     const offenders = await this.languageRepo.find({
       where: { isLearningAvailable: true, levelFramework: IsNull() }
     });
     const allowed = new Set(['vi','th']);
     const bad = offenders.filter(l => !allowed.has(l.code));
     if (bad.length) {
       const msg = `Languages missing levelFramework: ${bad.map(b => b.code).join(',')}`;
       if (process.env.NODE_ENV !== 'production') throw new Error(msg);
       else this.logger.warn(msg);
     }
   }
   ```
4. Update `language.service.spec.ts`:
   - Case: add user language with valid level passes
   - Case: add user language with invalid level throws BadRequest
   - Case: add user language with omitted level defaults to framework[0]
   - Case: update with wrong-framework level rejects
5. Run `npm run build` + `npx jest src/modules/language` — all green.

## Todo List
- [ ] Update seed file with `levelFramework` per entry
- [ ] Import registry helpers in `language.service.ts`
- [ ] Add `resolveDefaultLevel` helper
- [ ] Wire validation in `addUserLanguage`
- [ ] Wire validation in `updateUserLanguage`
- [ ] Add `onModuleInit` invariant check
- [ ] Update service spec with 4 new cases
- [ ] `npm run build` + jest passes

## Success Criteria
- Seed produces a DB identical (re: framework columns) to migrated state.
- `addUserLanguage` rejects bad level with `400 BadRequest`.
- Omitting `proficiencyLevel` defaults to lowest level in framework.
- Boot throws in dev when en/es/fr/de/pt/ja/zh/ko lack framework.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Duplicate validation (DTO validator + service) confusing errors | Low | Low | DTO validator catches most; service is belt-and-suspenders; log both |
| onModuleInit throws crash loop in prod on mislabeled new language | Low | High | Warn-only in prod; throw only in non-prod |
| Default-to-lowest level surprises users who expected error | Low | Low | Documented behavior; covered by spec |

## Security Considerations
- Bad user input reaches service only past DTO validation; service check defends against direct internal calls (e.g., onboarding service path — phase 5).
- Error messages leak valid-value list — acceptable.

## Next Steps
- Phase 5 wires onboarding save-path to map generic AI output to framework-native before calling `addUserLanguage`.
