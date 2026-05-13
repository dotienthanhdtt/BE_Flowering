---
phase: 1
title: "Migration & Entity"
status: completed
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Migration & Entity

## Overview

Create `scenario_evaluations` table + TypeORM entity. Add `completed_at` column to `ai_conversations`. Register entity in both `database.module.ts` and scenario module's `TypeOrmModule.forFeature` (per project Railway-deploy rule — missing either causes runtime errors).

## Requirements

- Functional: persist one evaluation per conversation, FK cascades, queryable by user/scenario
- Non-functional: UNIQUE(conversation_id) for DB-level idempotency, indexes for analytics

## Architecture

```sql
CREATE TABLE scenario_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL UNIQUE REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id     uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  overall_score   smallint NOT NULL,
  fluency_score   smallint NOT NULL,
  accuracy_score  smallint NOT NULL,
  vocab_score     smallint NOT NULL,
  strengths       text[] NOT NULL DEFAULT '{}',
  improvements    text[] NOT NULL DEFAULT '{}',
  summary         text NOT NULL,
  vocab_usage     jsonb,
  model_used      varchar(64) NOT NULL,
  prompt_version  smallint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_eval_user_created ON scenario_evaluations(user_id, created_at DESC);
CREATE INDEX idx_scenario_eval_scenario ON scenario_evaluations(scenario_id);

ALTER TABLE ai_conversations ADD COLUMN completed_at timestamptz NULL;
```

## Related Code Files

- Create: `src/database/entities/scenario-evaluation.entity.ts`
- Create: `src/database/migrations/{ts}-create-scenario-evaluations.ts`
- Modify: `src/database/entities/ai-conversation.entity.ts` (add `completedAt` field)
- Modify: `src/database/database.module.ts` (register `ScenarioEvaluation` in global entities array)
- Modify: `src/database/entities/index.ts` (export new entity)

## Implementation Steps

1. Generate migration: `npm run migration:generate src/database/migrations/CreateScenarioEvaluations` (or hand-write — match existing migration style in `src/database/migrations/`)
2. Migration up: create table + indexes + alter ai_conversations
3. **Migration down: RENAME `scenario_evaluations` → `scenario_evaluations_archived_${timestamp}` instead of DROP** — preserves paid LLM-generated data on rollback. Drop `completed_at` column is acceptable (no data to preserve there). _[Red Team #8]_
4. Create `ScenarioEvaluation` entity matching column types; use `@Column({ type: 'smallint' })` for scores, `@Column('text', { array: true })` for arrays, `@Column({ type: 'jsonb', nullable: true })` for vocab_usage
5. Add `@ManyToOne` relations: AiConversation, User, Scenario (with `{ onDelete: 'CASCADE' }`)
6. Export from `src/database/entities/index.ts`
7. Add `completedAt: Date | null` to `AiConversation` entity with `@Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })`
8. Register `ScenarioEvaluation` in **BOTH** `database.module.ts` global entities array **AND** `src/database/typeorm-data-source.ts` entities array (the latter is used by migration CLI; missing it causes inconsistent CI/prod migration behavior). _[Red Team #9]_
9. Run `npm run migration:run` locally → verify schema
10. Run `npm run build` → confirm no TS errors

## Cross-Phase Note on `completed_at`

`completedAt` is set in **both** code paths to keep the column meaningful:
- `/complete` endpoint (Phase 4) — primary writer
- Chat path DONE flip (`scenario-chat.service.ts:218`) — Phase 5 must also set `completedAt = new Date()` when flipping to DONE via `isEnd` or `hardEnd`. Otherwise column is ~always NULL (chat is the dominant DONE-producer). _[Red Team #5]_

## Success Criteria

- [ ] Migration generated, up + down both work
- [ ] Entity compiles, FK relations defined
- [ ] Registered in `database.module.ts`
- [ ] `npm run build` passes
- [ ] Manual `psql \d scenario_evaluations` shows expected schema

## Risk Assessment

- **Risk:** forgetting to register entity globally → runtime `EntityMetadataNotFoundError` (per CLAUDE.md, 2026-03-08 incident).
  **Mitigation:** registration step is explicit in step 8 + must be in checklist.
- **Risk:** existing `ai_conversations` rows have `completed_at = NULL` for already-DONE convos.
  **Mitigation:** acceptable — backfill not needed; new convos use the column from now on.
