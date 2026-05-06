# Project Manager Report — Language-Specific Proficiency Levels (Backend Completion)

**Date:** 2026-04-21 19:25  
**Plan:** `plans/260421-1855-language-specific-levels/`  
**Status:** Backend phases 1–5 completed; Flutter (phase 6) + E2E/deploy (phase 7) pending

## Updates Applied

### Plan Files

**`plan.md`:**
- Main status: `pending` → `in-progress` (reflects 5/7 phases done)
- Phase table: rows 1–5 status changed from `pending` → `completed`

**Phase status files (1–5):**
- Each phase Overview section: `Status: pending` → `Status: completed`
  - `phase-01-framework-registry.md`
  - `phase-02-entity-dto-validator.md`
  - `phase-03-database-migration.md`
  - `phase-04-seed-and-service.md`
  - `phase-05-onboarding-mapping.md`

### Documentation Updates

**`docs/api-documentation.md`:**
- **GET /languages/user** (line 298): Response data now includes `level_framework` field. Added note explaining framework codes (CEFR/JLPT/HSK/TOPIK) and null case.
- **POST /languages/user** (lines 307–313): Request example changed from generic `"beginner|intermediate|advanced|native"` to CEFR example `"A1"`. Added note listing valid values per framework + omit-to-default behavior.
- **PATCH /languages/user/:languageId** (lines 324–328): Request example changed from generic `"intermediate"` to CEFR example `"B1"`. Added note on framework-specific validation.

### Files NOT Modified

- `docs/codebase-summary.md` — no references to ProficiencyLevel enum; no updates needed
- `docs/code-standards.md` — no updates needed
- `docs/system-architecture.md` — no updates needed
- Any phase 6–7 files — pending Flutter/E2E work

## Backend Completion Summary

All backend logic shipped:
- Framework registry (LANGUAGE_FRAMEWORKS constant + 3 helpers)
- Custom validator (@IsValidLevelForLanguage) for DTO validation
- Migration 1778000500000 (schema + data backfill)
- Seed + service validation (onModuleInit invariant check)
- Onboarding level mapping (generic → framework-native)
- 403 tests passing, build clean

## Scope Status

**Locked exclusions (per plan) — untouched as intended:**
- `src/modules/ai/prompts/scenario-chat-prompt.json` (literal check on 'beginner' accepted as breaking)
- `src/modules/ai/services/scenario-chat.service.ts` (no isBeginnerTier work)

## Next Steps

1. **Phase 6:** Flutter model + LanguageLevelPicker widget (not in scope of this update)
2. **Phase 7:** Swagger + E2E + staging deploy (not in scope of this update)
3. Verify link in API docs (lines 300, 315, 331) match actual implementation

## Unresolved Questions (carried forward from plan)

- Langfuse prompt-versioning impact of relaxed `chat.dto.ts` enum
- Lesson content coverage gaps at HSK5/HSK6 and C2 (deferred)
- Post-migration grace shim for stale clients (recommend 400 after 48h telemetry)
