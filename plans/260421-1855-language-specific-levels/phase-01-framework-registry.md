# Phase 1 — Framework Registry + Helpers + Unit Tests

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §1, §3
- No existing `src/common/constants/` — will be created

## Overview
- Priority: P1 (foundation; everything else imports from here)
- Status: completed
- Effort: 45m
- Brief: Build the single source of truth for level frameworks plus three pure helpers. Cover with unit tests before any other code depends on them.

## Key Insights
- Registry is a constant map; consumers read-only — no service class needed (YAGNI).
- Mappers are pure functions → easy to test without DB or DI.
- `GENERIC` kept as a fallback framework for languages without a formal standard (used by migration + possible future languages).

## Requirements

**Functional**
- Export `FrameworkCode` type: `'CEFR' | 'JLPT' | 'HSK' | 'TOPIK' | 'GENERIC'`
- Export `LANGUAGE_FRAMEWORKS` const map (values from brainstorm §1)
- `isValidLevel(framework, level)` → boolean
- `mapUserLevelToContentDifficulty(framework, level)` → `'beginner' | 'intermediate' | 'advanced'`
- `mapGenericToFramework(framework, generic)` → framework-native level string

**Non-functional**
- Pure, sync, no I/O
- Under 200 lines total
- 100% branch coverage on helpers

## Architecture
Single file `src/common/constants/language-levels.ts`. Exported via `src/common/index.ts` for clean imports.

## Related Code Files

**Create**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/common/constants/language-levels.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/common/constants/language-levels.spec.ts`

**Modify**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/common/index.ts` (export new constants module)

## Implementation Steps

1. Create `src/common/constants/` dir.
2. Write `language-levels.ts`:
   - Define `FrameworkCode` type + `LANGUAGE_FRAMEWORKS` record (exact arrays per brainstorm §1).
   - `isValidLevel(framework, level)` — indexOf check against framework array.
   - `mapUserLevelToContentDifficulty(framework, level)`:
     - CEFR: A1/A2→beginner, B1/B2→intermediate, C1/C2→advanced
     - JLPT: N5/N4→beginner, N3→intermediate, N2/N1→advanced
     - HSK: HSK1/HSK2→beginner, HSK3/HSK4→intermediate, HSK5/HSK6→advanced
     - TOPIK: TOPIK1/TOPIK2→beginner, TOPIK3/TOPIK4→intermediate, TOPIK5/TOPIK6→advanced
     - GENERIC: beginner/elementary→beginner, intermediate/upper_intermediate→intermediate, advanced→advanced
     - Unknown level → throw `Error('Unknown level {level} for framework {framework}')`
   - `mapGenericToFramework(framework, generic)` — lookup table per brainstorm §3. Throw on unknown generic.
3. Re-export from `src/common/index.ts`.
4. Write `language-levels.spec.ts`:
   - `isValidLevel`: true for every canonical level, false for cross-framework + garbage
   - `mapUserLevelToContentDifficulty`: one case per tier per framework + unknown throws
   - `mapGenericToFramework`: full 5×4 matrix per brainstorm + unknown throws
5. Run `npx jest src/common/constants/language-levels.spec.ts` — must pass.
6. Run `npm run build` — must succeed.

## Todo List
- [ ] Create `src/common/constants/` directory
- [ ] Write `language-levels.ts` with registry + 3 helpers
- [ ] Export from `src/common/index.ts`
- [ ] Write `language-levels.spec.ts` with full matrix
- [ ] `npx jest` passes for new spec
- [ ] `npm run build` passes

## Success Criteria
- File under 200 lines.
- `npx jest src/common/constants/language-levels.spec.ts` green.
- All three functions handle every documented input + throw on unknown.
- TS compiles with strict mode.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Off-by-one in CEFR tier mapping | Low | Medium | Explicit tests per level |
| Helper signature drift vs. brainstorm | Low | High | Match signatures in §1 verbatim; other phases import them |

## Security Considerations
- Registry is read-only data; no injection surface.
- Helpers throw on unknown input — callers must handle (validator in phase 2 does).

## Next Steps
- Phase 2 imports `isValidLevel` into custom class-validator decorator.
- Phase 3 imports `mapGenericToFramework` for migration data backfill.
