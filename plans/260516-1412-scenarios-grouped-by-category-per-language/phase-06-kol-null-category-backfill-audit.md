---
phase: 6
title: "KOL + null-category backfill audit"
status: completed
priority: P1
effort: "2h"
dependencies: [1, 2]
---

# Phase 6: KOL + null-category backfill audit

## Overview
Backfill `scenarios.category_id` for any row still NULL after phase 1 — primarily legacy personal scenarios and KOL scenarios where admin omitted category. Runs after `for_you` rows seeded but trigger can fire safely for `INSERT` cases; this phase does explicit `UPDATE`s so audit logs are clear.

## Requirements
- Functional: zero scenarios with `category_id IS NULL` after migration runs.
- Functional: backfill respects scenario's `language_id` (no cross-language assignment).
- Non-functional: audit log printed in migration output for traceability.

## Architecture

### Audit pre-check
```sql
SELECT type, COUNT(*) AS null_count
  FROM scenarios
 WHERE category_id IS NULL
 GROUP BY type;
```
Log to console; informational.

### Backfill
```sql
UPDATE scenarios s
   SET category_id = c.id
  FROM scenario_categories c
 WHERE c.language_id = s.language_id
   AND c.slug = 'for_you'
   AND s.category_id IS NULL;
```
KOL rows with NULL category land in `for_you` of their language. Admin can recategorize manually later.

### Optional NOT NULL constraint
After backfill, **do not** set `scenarios.category_id` NOT NULL yet — the trigger guarantees no future NULLs, and a NOT NULL constraint would conflict with TypeORM `.save()` semantics where the field is omitted (Postgres still calls the trigger). Keep nullable at column level; trigger enforces fill.

Alternative: add `CHECK (category_id IS NOT NULL)` constraint AFTER trigger install — verify TypeORM compatibility before deciding. Defer to red-team if needed.

## Related Code Files
- Create: `src/database/migrations/{ts}-backfill-null-category-id-on-scenarios.ts`

## Implementation Steps
1. Write migration with pre-check SELECT (logged via `console.log` from migration runner).
2. Run UPDATE backfill.
3. Run post-check: `SELECT COUNT(*) FROM scenarios WHERE category_id IS NULL` → expect 0.
4. Raise migration error if post-check > 0 (likely indicates orphan `language_id` with no `for_you` row).
5. Down migration: no-op (cannot reliably reverse NULLs).
6. Run on Railway dev.

## Success Criteria
- [ ] Pre-check output captured in migration log.
- [ ] All NULL `category_id` rows backfilled.
- [ ] Post-check returns 0.
- [ ] Migration fails loudly if backfill incomplete.

## Risk Assessment
- **Risk:** Scenario with `language_id` not in `languages` table (orphan) → no `for_you` row matches, post-check fails. **Mitigation:** phase 1 pre-flight already flags this; if persists, fix data manually before this migration.
- **Risk:** Many KOL rows silently move to `for_you` instead of admin's intended category. **Mitigation:** acceptable — admin can recategorize via admin module; alternative is manual SQL per bundle which exceeds scope.
- **Risk:** No `for_you` row for some language (phase 2 didn't seed). **Mitigation:** phase 2 success criteria; this migration verifies via post-check.
