---
type: brainstorm
date: 2026-04-21
slug: language-specific-levels
status: ready-for-plan
---

# Brainstorm: Language-Specific Proficiency Levels

## Problem Statement

Current system stores user proficiency as a single shared 5-tier enum (`beginner | elementary | intermediate | upper_intermediate | advanced`) on `user_languages.proficiency_level`, applied identically to all 10 supported languages. Native frameworks (CEFR for European languages, JLPT for Japanese, HSK for Chinese, TOPIK for Korean) are not represented, reducing perceived authenticity and learning targeting accuracy.

Goal: each learning-available language exposes its own standard level taxonomy. Native-only languages stay frameworkless.

## Requirements

**Functional**
- Each language with `isLearningAvailable = true` has exactly one level framework.
- User level validated against its language's framework.
- Existing users auto-migrated to equivalent native-framework level.
- Lesson/Scenario content retains existing 3-tier difficulty — user level mapped to 3-tier at query time.
- AI prompts receive raw framework-native level string (no normalization layer).
- Flutter level picker renders correct list per language.

**Non-functional**
- Single Postgres migration, reversible.
- Zero runtime regression for existing tutor/scenario chat.
- No new service or module — fits existing `language` module.

## Evaluated Approaches

| Option | Shape | Verdict |
|---|---|---|
| **A. Polymorphic per-language (chosen)** | `languages.level_framework` + `user_languages.proficiency_level` as string validated against framework | ✅ KISS, fixed 1-framework-per-language, auto-maps cleanly |
| B. User-picks-framework-per-language | Multiple frameworks per language, user selects | Rejected — YAGNI, adds picker UX + mapping complexity |
| C. Shared CEFR + display-only labels | Internal CEFR, per-language display strings | Rejected — lossy (JLPT≠CEFR exactly); users see mismatched data if DB inspected |

Further sub-decisions (evaluated+chosen):
- **AI prompt handling**: raw label (C) over framework+description (A) or CEFR-normalization (B). Trade-off: accepts LLM framework-knowledge variance for zero prompt-rewrite cost.
- **Migration**: auto-map over reset-and-ask (user friction too high) over dual-mode (tech debt).
- **Content difficulty**: unchanged 3-tier (smallest blast radius).

## Final Recommended Solution

### 1. Framework registry — in code

`src/common/constants/language-levels.ts` (new)

```ts
export type FrameworkCode = 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK' | 'GENERIC';

export const LANGUAGE_FRAMEWORKS: Record<FrameworkCode, readonly string[]> = {
  CEFR:    ['A1','A2','B1','B2','C1','C2'],
  JLPT:    ['N5','N4','N3','N2','N1'],
  HSK:     ['HSK1','HSK2','HSK3','HSK4','HSK5','HSK6'],
  TOPIK:   ['TOPIK1','TOPIK2','TOPIK3','TOPIK4','TOPIK5','TOPIK6'],
  GENERIC: ['beginner','elementary','intermediate','upper_intermediate','advanced'],
} as const;

export function isValidLevel(framework: FrameworkCode, level: string): boolean;
export function mapUserLevelToContentDifficulty(framework, level): 'beginner'|'intermediate'|'advanced';
export function mapGenericToFramework(framework: FrameworkCode, generic: string): string; // for migration + onboarding suggest
```

Content-tier mapper:
- tier 1 (bottom 2 of framework) → `beginner`
- tier 2 (middle 2) → `intermediate`
- tier 3 (top 2) → `advanced`
- CEFR: A1/A2→beginner, B1/B2→intermediate, C1/C2→advanced
- JLPT: N5/N4→beginner, N3→intermediate (single middle in 5-tier), N2/N1→advanced
- HSK: HSK1/HSK2→beginner, HSK3/HSK4→intermediate, HSK5/HSK6→advanced
- TOPIK: same 2-2-2 split
- GENERIC: beginner/elementary→beginner, intermediate/upper_intermediate→intermediate, advanced→advanced

### 2. Schema changes

```sql
-- Add framework to languages (nullable: only learning-available languages populated)
ALTER TABLE languages
  ADD COLUMN level_framework VARCHAR(16) NULL;

-- Backfill per seed
UPDATE languages SET level_framework='CEFR'    WHERE code IN ('en','es','fr','de','pt');
UPDATE languages SET level_framework='JLPT'    WHERE code='ja';
UPDATE languages SET level_framework='HSK'     WHERE code='zh';
UPDATE languages SET level_framework='TOPIK'   WHERE code='ko';
-- vi, th: stay NULL (not learning-available → no framework needed)

-- Loosen proficiency_level on user_languages
ALTER TABLE user_languages ALTER COLUMN proficiency_level TYPE VARCHAR(16) USING proficiency_level::text;
DROP TYPE IF EXISTS proficiency_level_enum;

-- Backfill existing rows to framework-native
-- Positional map via mapGenericToFramework() run in migration code
```

### 3. Auto-map existing users (one-shot SQL in migration)

```
generic               CEFR  JLPT  HSK     TOPIK
beginner              A1    N5    HSK1    TOPIK1
elementary            A2    N4    HSK2    TOPIK2
intermediate          B1    N3    HSK3    TOPIK3
upper_intermediate    B2    N2    HSK4    TOPIK4
advanced              C1    N1    HSK6    TOPIK6
```

Notes:
- CEFR C2 reserved for manual opt-in (not reached via auto-map)
- HSK5 skipped to keep 5-tier map clean (HSK4 is mid-upper, HSK6 is top)
- Rows for languages without framework (vi/th) stay as-is (schema allows any string)

### 4. Entity changes

- `language.entity.ts`: add `levelFramework: string | null`
- `user-language.entity.ts`: drop `ProficiencyLevel` enum; `proficiencyLevel: string`
- Consumers of `ProficiencyLevel` enum switch to string; keep re-export as deprecated type alias during rollout if needed (YAGNI — probably drop outright)

### 5. DTOs

- `AddUserLanguageDto.proficiencyLevel`, `UpdateUserLanguageDto.proficiencyLevel` → `string` + `@IsString()` + custom `@IsValidLevelForLanguage('languageId')` validator that looks up the language's framework and checks membership.
- `UserLanguageDto` gains `levelFramework: string | null` so frontend knows which picker to render.
- Swagger: replace `enum: ProficiencyLevel` with oneOf-style `examples: ['A1','B1','N3','HSK3','TOPIK2','beginner']` + `x-level-framework` hint.

### 6. Service layer

`language.service.ts`:
- `addUserLanguage`: if dto.proficiencyLevel omitted → use `framework[0]` (lowest); validate against framework
- `updateUserLanguage`: validate against framework
- Keep existing "single active language" rule untouched

### 7. AI prompt layer — zero change

`scenario-chat.service.ts:294` still returns `{ targetLanguage, nativeLanguage, proficiencyLevel }`. The `proficiencyLevel` string becomes `"N3"` or `"B1"` instead of `"intermediate"`. Prompt templates (`tutor-system-prompt.md`, `scenario-chat-prompt.json`) already do raw `{{proficiencyLevel}}` substitution — LLM handles the label.

**Exception**: `scenario-chat-prompt.json` has hardcoded check `if proficiency_level is 'beginner'`. Replace with a pre-computed flag injected by the service using `mapUserLevelToContentDifficulty()`:
```json
"Reply ONLY in {{targetLanguage}}; include a brief {{nativeLanguage}} gloss in parentheses only if {{isBeginnerTier}} is true"
```

### 8. Onboarding suggestion → framework-native

`onboarding-extraction-prompt.md` still asks AI to return generic `"suggestedProficiency": "beginner | intermediate | advanced"`. On save, onboarding service calls `mapGenericToFramework(language.framework, suggestion)` before writing. No AI prompt rework.

### 9. Flutter impact

- `UserLanguageModel.proficiencyLevel: String` — already correct, no change
- `UserLanguageModel` add `levelFramework: String?` parsed from API
- New widget: `LanguageLevelPicker(frameworkCode, selected, onChange)` — renders correct level list; mirror `LANGUAGE_FRAMEWORKS` map in Dart constant file `lib/core/constants/language_levels.dart`
- Profile/settings screen: replace existing generic picker with `LanguageLevelPicker` driven by active language's framework
- Onboarding: no UI change (AI-inferred path unchanged)

## Files Touched

**New**
- `src/common/constants/language-levels.ts`
- `src/common/validators/is-valid-level-for-language.validator.ts`
- `src/database/migrations/{ts}-language-specific-levels.ts`
- Flutter: `lib/core/constants/language_levels.dart`, `lib/features/language/widgets/language_level_picker.dart`

**Modified**
- `src/database/entities/language.entity.ts`
- `src/database/entities/user-language.entity.ts`
- `src/database/seeds/language-seed-data.ts`
- `src/modules/language/dto/{add,update}-user-language.dto.ts`
- `src/modules/language/dto/user-language.dto.ts`
- `src/modules/language/language.service.ts`
- `src/modules/ai/prompts/scenario-chat-prompt.json`
- `src/modules/ai/services/scenario-chat.service.ts` (inject `isBeginnerTier`)
- `src/modules/ai/dto/chat.dto.ts` (relax proficiencyLevel string + add framework field)
- `src/modules/onboarding/{service}.ts` (map generic → framework-native on save)
- Flutter: `UserLanguageModel`, level picker screens

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Migration down-rollback loses framework-native values | `down()` auto-maps framework-native → generic via inverse table; acceptable data loss for admin-initiated rollback |
| LLM misinterprets HSK/TOPIK labels | Monitor via Langfuse; if quality drops, fall back to raw label + short descriptor in prompt (reintroduce Option A) |
| Flutter stale clients sending `"intermediate"` after backend flip | Validator returns 400 with helpful message + mapped suggestion; can add grace shim mapping generic→framework on input for N releases if support data warrants |
| Onboarding AI still says `"beginner"` | Backend maps before persist — stale prompt is harmless |
| Seed drift (new language added, framework forgotten) | Add seed-time invariant: if `isLearningAvailable=true` then `levelFramework != null` — throws on boot |

## Success Metrics

- All existing users' proficiency rows successfully migrated (count before = count after)
- Zero 500s on `POST/PATCH /languages/user` in staging over 48h
- Swagger docs render correct enum per language
- Flutter picker renders JLPT list for Japanese, CEFR list for English, etc.
- No regression in tutor/scenario chat quality (spot-check Langfuse traces)

## Validation Criteria

- Unit: framework registry helpers (valid/invalid levels, mappers)
- Unit: validator accepts `B1` for English, rejects `N3` for English
- Integration: migration runs on seeded DB, all existing rows end up with framework-native values
- E2E: create Japanese user → pick N3 → scenario chat prompt receives `proficiency_level: "N3"`
- E2E: upgrade user from N5 to N3 via `PATCH` → rejects invalid `"X9"`

## Implementation Order (build sequence)

1. Framework registry + mappers + unit tests
2. Entity + DTO + validator changes (backend compiles)
3. Migration (schema + data)
4. Seed data update (new languages get framework)
5. Service validation wiring
6. Scenario prompt `isBeginnerTier` injection
7. Onboarding save-path mapping
8. Flutter model + picker + wire-up
9. Swagger regeneration + manual QA
10. Deploy staging → verify → deploy prod

## Unresolved Questions

- **Which seed languages are `isLearningAvailable = true` today?** Need to confirm against current DB/seed before writing migration. Current seed file may mark all 10 as learning — if so, vi/th would need framework too (revisit: GENERIC fallback?).
- **Langfuse prompt-versioning**: does changing `scenario-chat-prompt.json` require a new prompt version ID? Check Langfuse workflow before editing prompt file.
- **Lesson content tagging**: existing lessons tagged `beginner|intermediate|advanced` — is this coverage sufficient across all frameworks? (May discover lesson gaps at higher HSK5/HSK6 tiers once users can select them.)
