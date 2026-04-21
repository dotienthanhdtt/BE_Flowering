# Phase 6 — Flutter Model + LanguageLevelPicker Widget

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §9
- Existing user-language model: `app_flowering/flowering/lib/features/auth/models/user_language_model.dart`
- Flutter constants dir: `app_flowering/flowering/lib/core/constants/`
- Note: `lib/features/language/` does not exist yet — create directory.

## Overview
- Priority: P1
- Status: pending
- Effort: 1.5h
- Brief: Add Dart constants mirroring TS registry. Add `levelFramework` to `UserLanguageModel`. Build `LanguageLevelPicker` widget and wire it into profile/settings. Onboarding unchanged.

## Key Insights
- Dart constants must stay in sync with TS registry manually — accept duplication (DRY-across-runtimes not trivially achievable).
- `UserLanguageModel` only gains optional field — backward compatible with older API responses (during pre-migration staging window).
- Picker is dumb/controlled — parent owns selected state.

## Requirements

**Functional**
- `language_levels.dart`: mirror `LANGUAGE_FRAMEWORKS` map + `FrameworkCode` enum-equivalent (plain strings).
- `UserLanguageModel`: add `String? levelFramework` field; parse from `level_framework` JSON; serialize on toJson.
- `LanguageLevelPicker`: widget taking `{String? frameworkCode, String? selected, ValueChanged<String> onChanged}`; renders list for framework (or generic 5-tier if null); handles unknown selected by defaulting to first.
- Replace existing generic picker usage in `profile` / `settings` screen(s) with `LanguageLevelPicker` driven by active language's framework.
- Onboarding screens: unchanged (no user-facing level picker there per brainstorm §9).

**Non-functional**
- Widget file under 200 lines.
- No new state-management layer — widget is stateless (controlled).
- Backward-compatible model: `levelFramework` optional; existing callers continue to compile.

## Architecture
- Constants: static const Map
- Widget: stateless, takes callbacks
- Model: add field + update fromJson/toJson + copyWith

## Related Code Files

**Create**
- `/Users/tienthanh/Dev/new_flowering/app_flowering/flowering/lib/core/constants/language_levels.dart`
- `/Users/tienthanh/Dev/new_flowering/app_flowering/flowering/lib/features/language/widgets/language_level_picker.dart`

**Modify**
- `/Users/tienthanh/Dev/new_flowering/app_flowering/flowering/lib/features/auth/models/user_language_model.dart` — add `levelFramework`
- Profile / settings screen(s) that currently show proficiency picker — locate via grep, replace widget
- Controllers that set proficiency — accept the new framework-native string (likely already `String`)

**Not Modified**
- Onboarding flow UI

## Implementation Steps

1. Create `lib/core/constants/language_levels.dart`:
   ```dart
   const Map<String, List<String>> kLanguageFrameworks = {
     'CEFR':    ['A1','A2','B1','B2','C1','C2'],
     'JLPT':    ['N5','N4','N3','N2','N1'],
     'HSK':     ['HSK1','HSK2','HSK3','HSK4','HSK5','HSK6'],
     'TOPIK':   ['TOPIK1','TOPIK2','TOPIK3','TOPIK4','TOPIK5','TOPIK6'],
     'GENERIC': ['beginner','elementary','intermediate','upper_intermediate','advanced'],
   };
   List<String> levelsFor(String? framework) =>
     kLanguageFrameworks[framework ?? 'GENERIC'] ?? kLanguageFrameworks['GENERIC']!;
   ```
2. Modify `user_language_model.dart`:
   - Add `final String? levelFramework;`
   - Update constructor, `fromJson` (read `'level_framework'` as nullable String), `toJson`, `copyWith`
3. Create `lib/features/language/widgets/language_level_picker.dart`:
   - Stateless widget
   - Props: `frameworkCode`, `selected`, `onChanged`, optional `enabled`
   - Use `levelsFor(frameworkCode)` to drive options
   - Render as segmented buttons or dropdown — follow existing profile styling
   - If `selected` not in list, show first item highlighted + trigger `onChanged(first)` on build (opt-in behavior) OR just show unselected (safer — leave to parent)
4. Grep `lib/features/profile` and `lib/features/settings` for the existing proficiency picker; replace with `LanguageLevelPicker` fed by active user-language's `levelFramework`.
5. Ensure controller/state passes `levelFramework` through from model to picker.
6. Run `flutter analyze` — zero errors.
7. Run `flutter test` — existing tests green.
8. Add widget test for `LanguageLevelPicker`:
   - `frameworkCode: 'JLPT'` → renders 5 options
   - `frameworkCode: null` → renders 5 generic options
   - tap option → `onChanged` called with correct value

## Todo List
- [ ] Create `language_levels.dart` constants
- [ ] Add `levelFramework` to `UserLanguageModel`
- [ ] Create `LanguageLevelPicker` widget
- [ ] Swap existing picker in profile/settings
- [ ] Add widget test
- [ ] `flutter analyze` + `flutter test` pass

## Success Criteria
- Japanese user sees N5..N1.
- English user sees A1..C2.
- Korean user sees TOPIK1..TOPIK6.
- Vietnamese user (or any null-framework) sees generic 5-tier.
- Selecting a level calls the controller which PATCHes backend with correct framework-native string.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Flutter <> backend flip order causes 400s briefly | Medium | Low | Deploy backend first; Flutter app accepts either schema since `levelFramework` is optional; stale app sends old strings → 400 → user sees friendly error |
| Existing stored proficiency string doesn't match framework after migration | Low | Medium | Server migrates rows; stale client reads new string — picker gracefully handles out-of-range by showing it as selected text only |
| Dart const map drifts from TS registry | Medium | Medium | Add comment in both files: `// Keep in sync with src/common/constants/language-levels.ts` |
| i18n of level labels | Low | Low | Out of scope — labels are framework codes (language-independent) |

## Security Considerations
- Picker sends plain string — backend validator (phase 2) is authority.
- No client-side trust.

## Next Steps
- Phase 7 regenerates Swagger + runs E2E and deploys to staging.
