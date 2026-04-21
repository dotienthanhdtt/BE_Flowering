# Phase 5 — Onboarding Save-Path Mapping (Generic → Framework-Native)

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §8
- Service: `src/modules/onboarding/onboarding.service.ts`

## Overview
- Priority: P1
- Status: completed
- Effort: 30m
- Brief: Onboarding AI extraction returns generic proficiency (`beginner|intermediate|advanced`). Before persisting via `language.service.ts`, map to framework-native via `mapGenericToFramework`. Prompt file itself is unchanged.

## Key Insights
- AI prompt stays generic to keep prompt surface simple — mapping happens in TypeScript, not in LLM.
- Onboarding currently calls `addUserLanguage` (or equivalent persistence) on conversion — that is the single interception point.
- For languages without framework (vi/th), pass generic value through unchanged.

## Requirements

**Functional**
- Identify call site where onboarding-extracted `suggestedProficiency` is converted into a `user_languages` row.
- Before write: fetch language → if `levelFramework` set, call `mapGenericToFramework(framework, suggestion)` → use result as `proficiencyLevel`. If null, pass through (or default to `'beginner'` if empty).
- If `mapGenericToFramework` throws (AI returned unknown value), fall back to framework default (`LANGUAGE_FRAMEWORKS[framework][0]`) and log warning with the bad input.

**Non-functional**
- No AI prompt rewrite (`onboarding-extraction-prompt.md` untouched).
- No change to onboarding response shape (still returns chosen language + raw suggestion to frontend).

## Architecture
Single helper `mapOnboardingSuggestionToFrameworkLevel(language, suggestion)` in `onboarding.service.ts`. Called right before invoking `languageService.addUserLanguage`.

## Related Code Files

**Modify**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/onboarding/onboarding.service.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/onboarding/onboarding.service.spec.ts` — add cases

**Not Modified**
- `src/modules/ai/prompts/onboarding-extraction-prompt.md` — intentional

## Implementation Steps

1. Grep for existing `suggestedProficiency` / `proficiencyLevel` usage in onboarding service — locate the save call.
2. Add helper:
   ```ts
   private mapOnboardingLevel(
     framework: string | null,
     suggestion: string | undefined,
   ): string {
     const generic = (suggestion ?? 'beginner').toLowerCase();
     if (!framework) return generic;
     try {
       return mapGenericToFramework(framework as FrameworkCode, generic);
     } catch (e) {
       this.logger.warn(
         `Invalid onboarding suggestion '${generic}' for framework ${framework}; defaulting to ${LANGUAGE_FRAMEWORKS[framework][0]}`,
       );
       return LANGUAGE_FRAMEWORKS[framework as FrameworkCode][0];
     }
   }
   ```
3. Replace direct `addUserLanguage({ ..., proficiencyLevel: suggestion })` with:
   ```ts
   const level = this.mapOnboardingLevel(language.levelFramework, extraction.suggestedProficiency);
   await this.languageService.addUserLanguage(userId, { languageId: language.id, proficiencyLevel: level, ... });
   ```
4. Add spec cases:
   - `beginner` + CEFR → `A1`
   - `intermediate` + JLPT → `N3`
   - `advanced` + HSK → `HSK6`
   - garbage string + TOPIK → logs warn + defaults to `TOPIK1`
   - any string + null framework → passes through
5. Run `npm run build` + `npx jest src/modules/onboarding` — all green.

## Todo List
- [ ] Locate onboarding save-path call
- [ ] Add `mapOnboardingLevel` helper with fallback
- [ ] Wire helper into save call
- [ ] Add 5 spec cases
- [ ] `npm run build` + jest passes

## Success Criteria
- Onboarding rows always persist a valid framework-native level for framework-bound languages.
- Bad AI output never reaches DB; logs surface the issue.
- vi/th onboarding still works (passes generic through).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI output shape changes (e.g., proper case vs lowercase) | Medium | Low | `.toLowerCase()` normalization + fallback path |
| Onboarding has multiple save call sites | Low | Medium | Grep first; if >1, centralize via helper |
| Existing spec mocks `ProficiencyLevel` enum | Medium | Low | Replace with string literals when spec breaks |

## Security Considerations
- AI output is untrusted input → must be validated (try/catch guards it).
- No privilege escalation risk; only affects the user's own record.

## Next Steps
- Phase 6 mirrors registry + picker on Flutter client.
