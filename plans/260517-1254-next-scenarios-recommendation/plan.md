---
title: "next_scenarios recommendations in /scenario/complete"
description: "Append 2 priority-ranked scenario recommendations to /scenario/complete response, excluding scenarios the user has DONE."
status: pending
priority: P2
branch: "dev"
tags: [scenario, recommendations, api]
blockedBy: []
blocks: []
created: "2026-05-17T05:54:29.776Z"
createdBy: "ck:plan"
source: skill
---

# next_scenarios recommendations in /scenario/complete

## Overview

Extend `POST /scenario/complete` response with `next_scenarios: NextScenarioItemDto[]` — up to 2 recommendations selected by a strict 4-tier waterfall (un-locked + same category > un-locked + different category > locked + same category > locked + different category). Excludes scenarios the user has DONE conversations for. Always present; empty `[]` when no candidates.

## Priority rules (locked from brainstorm)
- **Anchor:** the just-completed scenario.
- **Exclude:** anchor itself + any scenario with a DONE conversation for this user.
- **Locked:** `access_tier='premium' AND user_not_premium AND no row in user_scenario_access`.
- **Same category:** anchor.category_id IS NOT NULL AND scenario.category_id = anchor.category_id (null=null is NOT same).
- **Tie-break inside tier:** `order_index ASC, created_at DESC`.
- **Strict waterfall:** fill top tier first, descend only if slots remain.
- **Premium user:** `is_locked=false` always → tiers 3 & 4 unused.
- **Random fallback:** dropped — tiers 1-4 partition the un-started pool, so fallback would only fire when pool is empty, which already returns `[]`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Implement](./phase-01-implement.md) | Pending |
| 2 | [Test](./phase-02-test.md) | Pending |

## Dependencies

None. Index `idx_ai_conversations_user_scenario` on `(user_id, scenario_id)` already exists (migration `1775700000000`), so the `NOT EXISTS` exclusion is cheap.
