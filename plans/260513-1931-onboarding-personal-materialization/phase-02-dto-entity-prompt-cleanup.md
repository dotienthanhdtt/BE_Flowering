---
phase: 2
title: "DTO + Entity + Prompt + Consumer Cleanup"
status: done
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: DTO + Entity + Prompt + Consumer Cleanup

## Overview
Remove `difficulty` everywhere it is read/written across the codebase (entity, DTOs, services, AI prompts, seed data, admin tooling, lesson filtering, redeem flow). Remove `icon`/`accentColor` from `OnboardingScenarioDto`. Update the LLM scenario prompts to stop instructing the model about `difficulty`. Sweep spec files that import `ScenarioDifficulty`.

This phase ships BEFORE Phase 1 migration to keep production code safe during deploy (two-step deploy enforced at plan level).

## Requirements
- Functional: no code path reads or writes `scenarios.difficulty`; no API response includes `difficulty`; no AI prompt mentions difficulty; `lesson?level=...` filter is removed; redeem response stops emitting difficulty; onboarding DTO has only `id, title, description`.
- Non-functional: `npm run build` AND `npm test` (compile only — full Jest suite is Phase 5) succeed at end of phase.
- Public API contract: `GET /scenarios/personal`, `/scenarios/default`, `/scenarios/:id`, `/scenarios/redeem`, `/lessons` lose `difficulty` field. **Mobile UX regression accepted** per plan-level decision.

## Architecture
Sequential code edits. Order matters: prompts + admin tooling + lesson + redeem + DTOs + entity + spec sweep. Goal: pass `npm run build` AND keep tests compiling (Jest may have failing assertions to be fixed in Phase 5, but compile must pass).

## Related Code Files

### AI prompts (Finding 6)
- Modify: `src/modules/ai/prompts/onboarding-scenarios-prompt.json:19` — remove `"Align difficulty with suggestedProficiency"` (and any other `difficulty` mentions).
- Modify: `src/modules/ai/prompts/personalize-scenarios-prompt.json:18` — same.
- Update few-shot/example JSON in BOTH prompts to drop `difficulty` field from sample output.

### Lesson module (Finding 1)
- Modify: `src/modules/lesson/lesson.service.ts:39` — remove the `qb.andWhere('scenario.difficulty = :level', { level })` filter and its parameter.
- Modify: `src/modules/lesson/lesson.service.ts:115` — remove `difficulty: scenario.difficulty` from mapped response.
- Modify: `src/modules/lesson/dto/get-lessons-query.dto.ts` — remove the `level` query parameter entirely (it filtered on scenario.difficulty).
- Modify: `src/modules/lesson/dto/<lesson-response-dto>.ts` — remove `difficulty` field if present.
- Note: This is a public API contract break. Document in changelog (Phase 5).

### Redeem flow (Finding 1)
- Modify: `src/modules/scenario/services/scenarios-redeem.service.ts:61` — drop `difficulty: s.difficulty`.
- Modify: `src/modules/scenario/dto/redeem-scenario.dto.ts:18` — remove `difficulty` property + `@ApiProperty()` decorator.

### Admin content (Finding 1)
- Modify: `src/modules/admin-content/admin-content.service.ts:191` — remove `difficulty: item.difficulty` from scenario draft insertion.
- Modify: `src/modules/admin-content/prompts/scenario-draft.md` — remove `difficulty` from the JSON schema/output example (lines :7, :12 per red-team citation).

### Seed data (Finding 1)
- Modify: `src/database/seeds/scenario-seed-data.ts` — remove `difficulty` from each seed entry (line ~:30 per citation).

### Scenario module
- Modify: `src/modules/scenario/dto/scenario-default.dto.ts` — drop `difficulty` field.
- Modify: `src/modules/scenario/dto/scenario-personal.dto.ts` — drop `difficulty` field.
- Modify: `src/modules/scenario/dto/scenario-detail.dto.ts` — drop `difficulty` field.
- Modify: `src/modules/scenario/services/scenarios-listing.service.ts` — drop `difficulty: s.difficulty` from default + personal + KOL mappings.
- Modify: `src/modules/scenario/services/scenarios-detail.service.ts` — drop `difficulty: scenario.difficulty` from mapped response.

### Personalization
- Modify: `src/modules/personalization/services/personalization.service.ts:244-252` — drop `difficulty: ScenarioDifficulty.BEGINNER` from returned partial. Do NOT yet replace with helper (Phase 3 owns the refactor). Just remove the field and the `ScenarioDifficulty` import.

### Onboarding
- Modify: `src/modules/onboarding/dto/onboarding-scenario.dto.ts` — drop `icon`, `accentColor`, `SCENARIO_ACCENT_COLORS`, `ScenarioAccentColor`. Keep `id`, `title`, `description`.
- Modify: `src/modules/onboarding/onboarding.service.ts:172-180` — `parseScenarios` returns only `{id: randomUUID(), title, description}`.

### Entity
- Modify: `src/database/entities/scenario.entity.ts` — drop `difficulty` column block + `ScenarioDifficulty` enum (verify enum has zero remaining usages first via grep).

### Spec sweep (Finding 10 — moved from Phase 5)
- Modify: `src/modules/scenario/services/scenarios-listing.service.spec.ts` — remove `ScenarioDifficulty` import + all `difficulty` assertions/fixtures.
- Modify: `src/modules/scenario/services/scenarios-redeem.service.spec.ts` — same.
- Modify: `src/modules/scenario/services/scenarios-detail.service.spec.ts` — same.
- Modify: `src/modules/onboarding/onboarding.service.spec.ts` + `onboarding.controller.spec.ts` — drop `icon`/`accentColor` references + `ScenarioAccentColor` imports.
- Modify: `src/modules/lesson/lesson.service.spec.ts` (if exists) — drop `level`/`difficulty` test cases.
- Modify: `src/modules/personalization/services/personalization.service.spec.ts` (if exists) — drop `difficulty` expectation.

## Implementation Steps
1. Update prompts first (`onboarding-scenarios-prompt.json`, `personalize-scenarios-prompt.json`). Easy wins, no compile impact.
2. Update lesson service + DTOs. Build will fail at this point if other files import the dropped `level` query field — fix inline.
3. Update redeem service + DTO.
4. Update admin-content service + prompt MD.
5. Update seed data file.
6. Update scenario DTOs + services (listing/detail).
7. Update personalization service.
8. Update onboarding DTO + service.
9. Update entity — remove column + enum.
10. **Spec sweep** — fix every `.spec.ts` that imports `ScenarioDifficulty` or asserts on the dropped fields. Use grep to find them.
11. Run `npm run build` → must pass.
12. Run `npx tsc --noEmit -p tsconfig.spec.json` (or equivalent) → spec files compile.
13. Smoke-run `npm run start:dev` → boots without runtime errors.

## Success Criteria
- [ ] `npm run build` passes with zero TS errors.
- [ ] `grep -rn "\.difficulty\b" src/` returns only migration files (Phase 1's drop migration).
- [ ] `grep -rn "ScenarioDifficulty" src/` returns only migration files.
- [ ] `grep -rn "icon\|accentColor" src/modules/onboarding/` returns no hits (excluding archived).
- [ ] No prompt JSON files contain "Align difficulty" or `difficulty` keys in examples.
- [ ] Spec files compile (build does not fail on spec imports).
- [ ] Swagger at `/api/docs` reflects new shapes (no `difficulty`, no `icon`/`accentColor`, no `level` query).
- [ ] App boots clean.

## Risk Assessment
- **Risk:** `GET /lessons?level=...` callers (mobile) break. **Mitigation:** mobile regression accepted at plan level; document in changelog. Mobile may ignore the unknown query param if backend uses `forbidNonWhitelisted: false` (verify global ValidationPipe config).
- **Risk:** Mobile Flutter cards lose visual identity (`icon`/`accentColor` defaults to plain). **Mitigation:** accepted per plan decision.
- **Risk:** spec files outside the listed set still import dropped symbols. **Mitigation:** explicit grep in step 10 + success criteria.
- **Risk:** removing `level` filter breaks an internal admin tool. **Mitigation:** Phase 2 step 4 includes admin-content sweep; if other admin routes reference `level`, fix in same phase.
- **Risk:** seed data file is run on test setup → tests would have failed already if it ran. **Mitigation:** Phase 5 verifies seeded data shape too.

## Documentation Note
- Phase 5 owns the docs update for the API contract break. This phase only updates the code.
