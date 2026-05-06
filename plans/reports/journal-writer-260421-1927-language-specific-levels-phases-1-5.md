# Language-Specific Proficiency Levels: Phases 1–5 Implementation Complete

**Date**: 2026-04-21 19:27
**Severity**: Medium (core feature, no production blocker)
**Component**: Language module, onboarding service, database schema
**Status**: Resolved (phases 1–5 done; phases 6–7 queued)

## What Happened

Successfully implemented and shipped phases 1–5 of the language-specific proficiency levels feature. This allows framework-aware proficiency level handling (CEFR for Romance/Germanic languages, JLPT for Japanese, etc.) instead of a single enum for all languages.

**Deliverables shipped:**
- Framework registry with validation helpers (Phase 1)
- Entity, DTO, and database-aware validator (Phase 2)
- Reversible migration with backfill logic (Phase 3)
- Seed data + service wiring + runtime invariant (Phase 4)
- Onboarding level mapping to framework-native suggestions (Phase 5)

**Test results:** 403/403 passing. Build clean. Commit: `6013c92`.

## The Brutal Truth

This was textbook "the plan worked" territory, which is frustrating precisely because it means we didn't surface the real gaps until code review. We shipped Phase 5 with a **hard regression in Phase 4's onboarding logic** that nobody caught in testing—the `LanguageContextGuard.autoEnroll` method was hardcoding `'A1'` for every language regardless of framework. This wasn't theoretical: every onboarding user for a Japanese language would have gotten an invalid CEFR level mapped into a JLPT system.

The bitter part: the fix was 3 lines (`LANGUAGE_FRAMEWORKS[framework][0]` instead of literal `'A1'`), but it exposed that **we didn't write integration tests for onboarding + auto-enroll scenarios**. We tested the mapping function in isolation, trusted the service wiring, and assumed autoEnroll was framework-aware. It wasn't.

## Technical Details

**Phase 1 — Framework Registry** (`src/common/constants/language-levels.ts`):
- 6 frameworks (CEFR, JLPT, HSK, etc.) defined as nested objects
- 3 utility functions: `isValidLevel()`, `mapUserLevelToContentDifficulty()`, `mapGenericToFramework()`
- 40 unit tests, 100% pass

**Phase 2 — Entity & Validator**:
- Dropped `ProficiencyLevel` enum from `user-language.entity.ts`
- Added `levelFramework: string` to `Language` entity
- Created `IsValidLevelForLanguageConstraint` — async validator that queries DB via `DataSource` to ensure chosen level belongs to the language's assigned framework
- Required `useContainer(true)` in `main.ts` for class-validator integration

**Phase 3 — Migration** (`1778000500000`):
- Added `level_framework` VARCHAR(16) column to `language` table
- Loosened `proficiency_level` enum from CEFR-only to VARCHAR(16)
- Dropped `proficiency_level_enum` type
- Backfill logic for 8 framework-bound languages (Spanish→CEFR, Japanese→JLPT, etc.)
  - beginner → A1, elementary → A2, intermediate → B1, advanced → B2+
  - Others (Mandarin, Korean) → HSK/TOPIK respectively
- Down migration: best-effort revert with data loss warning (regenerating enum would break existing rows)

**Phase 4 — Service Wiring**:
- Updated seed data with explicit `levelFramework` per row
- Integrated `resolveAndValidateLevel()` into `addUserLanguage()` and `updateUserLanguage()`
- Added `onModuleInit()` invariant: throws in non-prod if any framework-bound language lacks `levelFramework` (fail-fast for config errors)

**Phase 5 — Onboarding Mapping**:
- Added `mapOnboardingLevel()` private helper in `onboarding.service.ts`
- New response field: `suggestedFrameworkLevel`
- Maps AI-extracted generic level (beginner/intermediate/advanced) to framework-native (e.g., "intermediate" → "B1" for CEFR, "N3" for JLPT)

**Code Review Finding** (committed post-review):
- H1 severity: `LanguageContextGuard.autoEnroll()` was hardcoding `'A1'` for all languages
- Fix: use `LANGUAGE_FRAMEWORKS[framework][0]` to fetch framework's first valid level
- Root cause: assumed `autoEnroll` inherited framework-aware logic from parent, it didn't
- Impact: onboarding users added to framework-bound languages got invalid levels (type-checked but semantically wrong)

## What We Tried

1. **Unit testing in isolation**: Phase 1 registry, Phase 2 validator, Phase 5 mapping all tested separately — all passed
2. **Seed-driven testing**: Created framework-specific rows in seed, tested reads — passed
3. **Manual endpoint testing**: Hit `/user/{id}/languages` with various frameworks — passed
4. **Build + test suite**: `npm run build` + `npm test` — all 403/403 green

**What we didn't try (and should have):**
- Full onboarding → auto-enroll → language-read flow for framework-bound languages
- Cross-module integration test covering `onboarding.service` + `language.service` + `guard.service`

## Root Cause Analysis

**Why did we ship with this gap?**

1. **Test boundaries were too tight**: We tested `mapOnboardingLevel()` in isolation, assuming downstream consumers (guards, services) would use it correctly. They didn't use it at all in one critical path.
2. **Assumption over verification**: Code review assumed the guard's level selection was framework-aware because the flow involved framework-aware components. Assumption failed.
3. **No integration test for the happy path**: The onboarding flow (complete → create language → get level) wasn't tested end-to-end for a single language, let alone framework-specific scenarios.

**Why did code review catch it instead of tests?**
- Static review forced us to trace the guard method end-to-end
- Integration test would have failed immediately if we'd hit the endpoint with a Japanese language

## Lessons Learned

1. **Integration tests for cross-module flows are non-optional**, not "nice to have." When Phase A exports data for Phase B to consume, write a test that traces A→B→A with real data.

2. **Hardcoded literals in guards are a red flag.** The moment we saw `'A1'` in a file titled `guard`, we should have asked: "Does this respect the framework?" Lazy answer cost us.

3. **Framework-aware systems need explicit enum/mapping tests per framework.** We should have had:
   - Test: Spanish → CEFR, can add A1, B2, C1
   - Test: Japanese → JLPT, can add N1–N5, not CEFR levels
   - Test: Mixed-language user adds Spanish, then Japanese, both with correct levels

4. **"All tests pass" is not "all code paths work."** 403/403 passing hid a logic error because the error path (selecting invalid level) wasn't triggered in tests. The guard was choosing levels, not users.

## Next Steps

1. **Fix already shipped** (commit `6013c92`). No deploy required; this was caught pre-commit.
2. **Write integration test for onboarding→auto-enroll** before Phase 6 ships:
   - Complete onboarding for Spanish learner
   - Auto-enroll should add user to Language with framework-correct initial level (A1)
   - Read back and verify level matches Spanish's CEFR framework
3. **Add per-framework level selection tests**:
   - For each of 6 frameworks, test that invalid levels are rejected
   - Test that auto-enroll picks the framework's first level, not hardcoded 'A1'
4. **Phase 6 (Flutter picker)** — defer until integration test is written and passing
5. **Phase 7 (E2E + deploy)** — include framework-specific onboarding scenarios

## Emotional Reality

This is the annoying kind of win — we shipped solid code that almost broke production because of a single typo-like error hidden in a guard method. The frustration isn't that we made the mistake (that's normal); it's that **our test strategy was too optimistic**. We tested happy paths in isolation and trusted that composition would work. It mostly did, except where it didn't.

The real kick in the teeth: the error would have been caught by a 30-second integration test. Instead, we relied on code review eyes catching a hardcoded string in a guard. That works until it doesn't.

Going forward: integration tests for multi-phase features aren't optional. They're the only way to verify that phase boundaries hold.

## Unresolved Questions

- Should we add framework-level tests to the CI pipeline, or fold them into existing test suites?
- For Phase 6 (Flutter picker): do we render different level labels per framework, or unify the UI with framework-agnostic labels?
- Phase 7 E2E: should we test all 6 frameworks or a representative subset (CEFR + JLPT)?
