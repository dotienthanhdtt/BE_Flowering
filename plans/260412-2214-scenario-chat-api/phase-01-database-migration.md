# Phase 01: Database Migration + Entity Update

## Context Links
- Brainstorm: `plans/reports/brainstorm-260412-2214-scenario-chat-api.md`
- Entity: `src/database/entities/ai-conversation.entity.ts`

## Overview
- Priority: P1
- Status: complete
- Effort: S (30m)

Add `scenarioId` column to `ai_conversations` (needed for indexable find-or-create by `(userId, scenarioId)`). Store `maxTurns` + `completed` in existing `metadata` jsonb column to minimize schema drift.

## Key Insights

- `AiConversation` already has `metadata jsonb` column — reuse for flags, avoid new columns where not indexed.
- Only `scenarioId` needs its own column because it's a primary query key (find active conversation for user+scenario).
- Existing `type` enum is `ANONYMOUS | AUTHENTICATED` — scenario chat uses `AUTHENTICATED`, no enum change.
- `expiresAt` exists for anonymous sessions — leave null for authenticated scenario conversations.

## Requirements

**Functional**
- Query by `(userId, scenarioId, metadata->>'completed' = 'false')` must be fast.
- Column nullable (backward-compat with existing onboarding/tutor conversations).

**Non-functional**
- Migration must be idempotent (safe on re-run if possible).
- Down migration must cleanly reverse.

## Architecture

**Metadata shape** (when scenarioId set):
```json
{ "maxTurns": 12, "completed": false }
```

**Column addition**:
```sql
ALTER TABLE ai_conversations ADD COLUMN scenario_id uuid NULL REFERENCES scenarios(id) ON DELETE SET NULL;
CREATE INDEX idx_ai_conversations_user_scenario ON ai_conversations(user_id, scenario_id) WHERE scenario_id IS NOT NULL;
```

## Related Code Files

**Modify**
- `src/database/entities/ai-conversation.entity.ts` — add `scenarioId` column + FK relation
- `src/database/database.module.ts` — verify `AiConversation` registered (already is per scout)

**Create**
- `src/database/migrations/{timestamp}-add-scenario-id-to-ai-conversations.ts`

## Implementation Steps

1. Add column + relation to `ai-conversation.entity.ts`:
```ts
@ManyToOne(() => Scenario, { nullable: true, onDelete: 'SET NULL' })
@JoinColumn({ name: 'scenario_id' })
scenario?: Scenario;

@Column({ name: 'scenario_id', type: 'uuid', nullable: true })
scenarioId?: string;
```

2. Generate migration: `npm run migration:generate -- src/database/migrations/add-scenario-id-to-ai-conversations`

3. Verify generated migration adds column + FK + index. Edit if needed to add partial index:
```ts
await queryRunner.query(`CREATE INDEX idx_ai_conversations_user_scenario ON ai_conversations(user_id, scenario_id) WHERE scenario_id IS NOT NULL`);
```

4. Run: `npm run migration:run` locally, verify DB has column.

5. `npm run build` — ensure no TS errors.

## Todo List

- [x] Add `scenarioId` column + relation to `ai-conversation.entity.ts`
- [x] Generate TypeORM migration file
- [x] Manually add partial index on `(user_id, scenario_id)` WHERE scenario_id IS NOT NULL
- [x] Run migration locally + verify column in DB
- [x] `npm run build` clean
- [x] Commit migration + entity change

## Success Criteria

- `ai_conversations.scenario_id` column exists in DB
- Partial index created and shown in `\di ai_conversations`
- Entity loads without error at app startup
- `npm run build` passes

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Migration breaks prod data | Nullable column, no data mutation, safe |
| FK violation if scenario deleted | `ON DELETE SET NULL` preserves conversation |
| Index bloat | Partial index (only non-null) keeps small |

## Security Considerations
- None new — existing RLS/ownership checks on `AiConversation` suffice.

## Next Steps
- Phase 02: Use new column in service layer.
