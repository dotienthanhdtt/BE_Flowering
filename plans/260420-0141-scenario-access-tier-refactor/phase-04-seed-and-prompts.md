# Phase 04 — Seed data + LLM prompts

## Context Links
- Seed: `src/database/seeds/scenario-seed-data.ts`
- Prompts: `src/modules/admin-content/prompts/scenario-draft.md`, `lesson-draft.md`
- Can run parallel with Phase 03 (different files)

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Align seed INSERT SQL and LLM prompts to emit `access_tier` / `accessTier` instead of the dropped bool flags.

## Key Insights
- Seed file is consumed by `1775600000000-seed-scenario-categories-and-scenarios.ts` migration. **Do not** edit that historical migration — but the seed export is used by newer paths / dev scripts and must reflect the current entity shape to avoid future breakage if seed is re-executed.
- Seed maps existing rows:
  - `is_premium=true, is_trial=false` → `access_tier='premium'`
  - `is_premium=true, is_trial=true`  → `access_tier='free'` (trial collapses)
  - `is_premium=false`                → `access_tier='free'`
- `is_active=true` on all current seeds → maps to nothing (stays `status='published'` default)
- Prompt examples drive LLM JSON structure — must match DTO field names (`accessTier`).

## Requirements

### Functional
- `scenario-seed-data.ts` SQL INSERT column list: replace `is_premium, is_trial, is_active` with `access_tier`
- All value tuples: replace 3 booleans with single string `'free'` or `'premium'`
- Preserve row ordering + existing titles
- Update `scenario-draft.md` + `lesson-draft.md`:
  - Remove `isPremium`, `isTrial` fields
  - Add `accessTier: "free" | "premium"` field with guidance

### Non-functional
- Seed file stays functionally equivalent to current intent (free rows stay free; premium-non-trial stays premium; premium-trial rows become free)

## Architecture

### Trial → Free collapse mapping (per seed row)
Trial rows in current seed (count: 7): these become `free` and equivalent to other `free` rows — no behavior difference post-refactor.

## Related Code Files

**Modify:**
- `src/database/seeds/scenario-seed-data.ts`
- `src/modules/admin-content/prompts/scenario-draft.md`
- `src/modules/admin-content/prompts/lesson-draft.md`

**Do not modify:**
- `src/database/migrations/1775600000000-seed-scenario-categories-and-scenarios.ts` (historical — frozen)

## Implementation Steps

### scenario-seed-data.ts
1. Change column list: `(category_id, language_id, title, description, difficulty, access_tier, order_index)`.
2. For each row tuple, replace `false, false, true, N` → `'free', N` and `true, false, true, N` → `'premium', N` and `true, true, true, N` → `'free', N`.
3. Keep comment block updated: swap "Mix of free, trial, and premium" → "Mix of free and premium".

### scenario-draft.md
1. Replace field bullets:
   ```
   - accessTier: "free" | "premium" (use "premium" for complex business/formal scenarios)
   ```
2. Drop `isTrial` line entirely.
3. Update example JSON:
   ```json
   {"title":"Ordering at a Restaurant","description":"...","difficulty":"{{level}}","accessTier":"free","orderIndex":0}
   ```

### lesson-draft.md
1. Replace `isPremium` bullet with `accessTier: "free" | "premium"` (true for advanced grammar/vocabulary).
2. Update example JSON to use `"accessTier":"free"`.

## Todo List
- [x] Rewrite seed SQL column list + tuples
- [x] Update `scenario-draft.md` prompt
- [x] Update `lesson-draft.md` prompt
- [x] `npm run build` still passes (no TS in these files; safety check)
- [x] Sanity: count INSERTed rows matches prior (26 scenarios)

## Success Criteria
- `grep -n "is_premium\|is_trial\|is_active\|isPremium\|isTrial" src/database/seeds src/modules/admin-content/prompts` → 0 hits
- LLM example JSON in both prompts uses `accessTier`
- Seed row count unchanged

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM returns legacy `isPremium` field → silently dropped by whitelist | Med | Low | Prompt update aligns output; `admin-content.service` defaults to `FREE` so no crash |
| Seed re-run on DB that already has rows | Low | Low | Original migration `1775600...` uses raw SQL with no ON CONFLICT — but it runs once per DB; not re-triggered |

## Security Considerations
- No sensitive data in seed; public scenario metadata only.

## Next Steps
- Phase 05 updates tests; Phase 04 must be complete so tests match new contract
