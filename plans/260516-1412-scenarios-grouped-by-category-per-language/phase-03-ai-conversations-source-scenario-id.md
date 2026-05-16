---
phase: 3
title: "ai_conversations.source_scenario_id"
status: completed
priority: P2
effort: "2h"
dependencies: []
---

# Phase 3: ai_conversations.source_scenario_id

## Overview
Add nullable `source_scenario_id UUID` column to `ai_conversations` so the trigger flow can persist which scenario kicked off a personalization conversation. Used in phase 4 to inherit the source scenario's `category_id` onto generated personal scenarios.

## Requirements
- Functional: column is nullable (most conversations have no source scenario).
- Functional: foreign key to `scenarios(id)` with `ON DELETE SET NULL` (preserve conversations if scenario removed).
- Non-functional: zero impact on existing rows; backfill not required.

## Architecture

```sql
ALTER TABLE ai_conversations
  ADD COLUMN source_scenario_id UUID NULL
  REFERENCES scenarios(id) ON DELETE SET NULL;

CREATE INDEX idx_ai_conversations_source_scenario_id
  ON ai_conversations(source_scenario_id)
  WHERE source_scenario_id IS NOT NULL;
```

Partial index keeps index small (most rows are NULL).

## Related Code Files
- Create: `src/database/migrations/{ts}-add-source-scenario-id-to-ai-conversations.ts`
- Modify: `src/database/entities/ai-conversation.entity.ts` — add `sourceScenarioId?: string` + `@ManyToOne(() => Scenario)` relation.

## Implementation Steps
1. Read current `ai-conversation.entity.ts` for existing column pattern.
2. Write migration.
3. Update entity with `@Column({ type: 'uuid', name: 'source_scenario_id', nullable: true })` and optional relation.
4. `npm run build` to confirm.
5. Run migration on Railway dev.

## Success Criteria
- [ ] Column exists with correct type + FK + index.
- [ ] Entity reflects column; build passes.
- [ ] Existing conversation specs still pass.
- [ ] Migration reverts cleanly.

## Risk Assessment
- **Risk:** Long-running migration on large `ai_conversations` table due to ADD COLUMN with default. **Mitigation:** column is nullable with no DEFAULT — instant DDL in Postgres.
- **Risk:** Forgotten in onboarding flow (onboarding conversations should also leave column NULL, not crash). **Mitigation:** nullable column ensures no impact on existing flows.
