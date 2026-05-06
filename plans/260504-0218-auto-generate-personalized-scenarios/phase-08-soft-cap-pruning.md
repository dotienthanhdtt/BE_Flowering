# Phase 08 — Soft-Cap Prune-on-Insert + List Filter

## Context Links
- Brainstorm §6 (soft-cap row)
- Phase 03 (insertion site)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Lazy pruning: on each successful generation, after inserting 5 new scenarios, prune oldest UNUSED personal scenarios over cap (30). Also filter `GET /scenarios` list by `ownerUserId` for personal entries.

## Key Insights
- "Unused" = zero chat sessions. Required to avoid deleting scenarios user engaged with.
- Lazy = no cron; runs in same transaction as insert.
- Cap = 30 (locked decision); applies per-user only to `type='personal'`.

## Requirements
**Functional:**
- After insert: count user's personal scenarios; if >30, delete oldest unused until ≤30.
- `GET /scenarios` listing personal: filter `ownerUserId === currentUser` (likely already done by centralize-scenarios; verify).
- Favorites/sticky scenarios preserved (out of scope flag — v1 just uses "used" = has chat session).

**Non-Functional:**
- Pruning <100ms.
- Single SQL DELETE with subselect.

## Architecture
```
PersonalizationService.complete (after insert)
  └── PersonalizationPruneService.pruneIfNeeded(userId)
        └── DELETE FROM scenarios
             WHERE id IN (
               SELECT s.id FROM scenarios s
               LEFT JOIN ai_conversation c ON c.scenarioId = s.id
               WHERE s.ownerUserId = $1 AND s.type='personal'
               GROUP BY s.id
               HAVING COUNT(c.id) = 0
               ORDER BY s.createdAt ASC
               OFFSET 30
             )
```
Adjust join table to actual scenario→chat relation.

## Related Code Files
**Modify:**
- `src/modules/personalization/personalization.service.ts` — call prune after insert
- `src/modules/scenario/services/scenario-list.service.ts` (or equivalent) — verify filter

**Create:**
- `src/modules/personalization/services/personalization-prune.service.ts`

**Delete:** none

## Implementation Steps
1. Identify scenario↔chat-session relation (likely `scenario_chat` or similar).
2. Implement `pruneIfNeeded(userId)` with raw query or QueryBuilder.
3. Wire into `complete()` after successful insert + snapshot update.
4. Verify list endpoint filters by owner; add filter if missing.
5. Manual test: insert 35 scenarios with no chats; confirm 5 oldest removed.
6. `npm run build`.

## Todo List
- [ ] Prune service
- [ ] Identify chat relation
- [ ] Prune SQL
- [ ] Wire into complete()
- [ ] Verify scenario list filter
- [ ] Build clean

## Success Criteria
- User with 35 unused personal scenarios → after generation, 30 remain (oldest 10 pruned + 5 new = net 30).
- User with 35 used (has chats) → no pruning, count grows.
- Other users' scenarios untouched.

## Risk Assessment
- **Cascade FK from scenarios → ai_conversation** → confirm ON DELETE behavior; if RESTRICT, prune fails for "unused" scenarios that nonetheless have linked rows. Test.
- **Race: two concurrent generations both pruning** → trigger advisory lock (Phase 06) covers; complete() should also lock if not already.

## Security Considerations
- DELETE strictly scoped to `ownerUserId = currentUser`. Audit query.

## Next Steps
- Phase 09 tests prune behavior.
