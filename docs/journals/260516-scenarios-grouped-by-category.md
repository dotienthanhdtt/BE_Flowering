# Scenarios Grouped by Category Per-Language

**Date**: 2026-05-16 14:50
**Severity**: Medium
**Component**: Scenario organization, database schema, API
**Status**: Resolved

## What Happened

Shipped unified scenario grouping/c by category, cloned per language. Replaced two endpoints (`GET /scenarios/default` + `GET /scenarios/personal`) with single `GET /scenarios` returning categories + nested scenarios. Added `language_id` + `slug` to `scenario_categories` table; enforced uniqueness; auto-assigned `for_you` category per language. Replaced type-based ownership with category-based ownership. All 616 tests pass.

## The Brutal Truth

This was a **schema retrofit, not a clean refactor**. We bolted category ownership onto a system that always used `scenarios_type` for ownership, and that friction shows:

- **Dual identity problem**: Existing default scenarios carry no explicit `category_id` — we had to seed one `for_you` category per language and backfill NULL values post-deployment. That's operational debt.
- **Constraint removal**: Dropped the `scenarios_type_owner_check` constraint entirely because personal scenarios now carry `category_id` instead. Lost a safety guardrail.
- **Trigger landmine averted**: Initial trigger filtered by `is_active`, which meant if you deactivated the `for_you` category, all inserts would fail silently. Took code review to catch that.

## Technical Details

**Migration 1781700000000** cloned global categories per language, added uniqueness:
```sql
UNIQUE(language_id, slug)
```

**PL/pgSQL trigger** (`trg_scenarios_default_category`) auto-fills `category_id` on NULL:
- Removed `is_active` filter (safety issue)
- Looks up `for_you` category by slug only

**New NULL FK**: `ai_conversations.source_scenario_id` optional — personalization flow inherits parent scenario's category via `resolveCategoryId` helper, avoiding second DB round-trip.

**Atomic `markLastLearned`**: Single UPDATE statement instead of select-then-update. Race condition fixed but adds to query complexity.

## What We Tried

1. **Kept type-based ownership** → Realized personal scenarios couldn't carry both type AND category; violates constraint.
2. **Category filter in trigger** → Broke when deactivating for_you; removed it.
3. **Two-round-trip personalization** → Fetched conversation, then category separately; eliminated with passed-through context.
4. **Paginated endpoint per type** → Replaced with unified query; less chatty but SQL grew (CTE + in-memory grouping).

## Root Cause Analysis

**Design inherited conflicting models**: Categories are organizational (user-facing, language-scoped), but ownership was typed (system-facing, global). Retrofitting one onto the other required schema changes that left temporary state (NULL category_id) and removed safety checks.

**We should have separated concerns earlier**: All-in-one `scenarios_type` tried to do too much (personal vs default vs live). A language-scoped `category` + explicit personal flag would have been cleaner.

## Lessons Learned

- **Schema retrofits always cost more than upfront design**: Backfills, triggers, constraint removal, operational gotchas all surface post-merge.
- **Triggers that filter on state are landmines**: `is_active` filter + auto-insert = silent failures when state changes. Keep triggers dumb.
- **Passing objects through call stacks beats round-trips**: Eliminated second DB fetch for conversation details in personalization flow. Worth the plumbing.
- **Tests don't catch operational queries**: 616 tests passed, but the `is_active` filter bug lived in code review. Need schema-aware linting.

## Next Steps

1. **Monitor**: Watch for NULL `category_id` leakage post-deploy; backfill job should have caught all but watch for edge cases.
2. **Document**: Break schema change in API docs (old endpoints removed; version gate required on mobile).
3. **Debt**: Replace `scenarios_type` enum with explicit `category_id` + `is_personal` flag in next schema iteration; would avoid this retrofit entirely.
4. **Operational**: Add alert if any scenario inserts fail (indicates trigger broke).
