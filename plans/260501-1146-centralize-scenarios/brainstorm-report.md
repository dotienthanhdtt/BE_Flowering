# Centralize Scenarios — Brainstorm Report

**Date:** 2026-05-01
**Status:** Implemented (Phases 01-04 done, Phase 05 specs pending). Migration ran on dev DB 2026-05-01. `source_conversation_id` column added then dropped — see Final Schema for rationale.
**Trigger:** `POST /scenario/chat` returning 500 — `ai_conversations_scenario_id_fkey` violation when scenarioId resolves to `user_ai_scenarios`.

---

## Problem

`ai_conversations.scenario_id` has FK to `scenarios(id)` only. `ScenarioChatService.resolveChatScenario` accepts IDs from two tables (`scenarios`, `user_ai_scenarios`). Inserting an `ai_conversation` for a personal scenario violates the FK → 500.

Root cause: polymorphic content split across two tables, but referencing FKs assume one. Fix at root by unifying.

## Decision

Merge `user_ai_scenarios` into `scenarios`. Single content table with owner-aware access.

App not released → single big-bang migration. Skip RLS, use repo-method discipline.

## Final Schema

**`scenarios` table additions:**

| Column | Type | Notes |
|---|---|---|
| `owner_id` | uuid NULL, FK users(id) ON DELETE CASCADE | NEW. Set ⇒ personal row. |
| `category_id` | uuid NULL (was NOT NULL) | Relaxed. NULL only for personal. |
| `type` enum | adds `'personal'`; `'default'` renamed to `'system'` | |

**CHECK constraint:**
```sql
CHECK (
  (type = 'personal' AND owner_id IS NOT NULL AND category_id IS NULL)
  OR
  (type IN ('system','kol') AND owner_id IS NULL AND category_id IS NOT NULL)
)
```

**Indexes:**
- `(owner_id, language_id) WHERE type='personal'` — personal listing
- `(type, status, language_id, order_index)` — public catalog (verify not duplicate)

**Decision:** No `source_conversation_id`. Initially planned as a back-pointer from personal scenarios to their generating AI conversation, but no code path uses it. Dropped to keep the schema lean (YAGNI).

**Drop:** `user_ai_scenarios` table.

**FK on `ai_conversations.scenario_id`:** unchanged — works post-merge.

## Enum Changes

```ts
export enum ScenarioType {
  SYSTEM = 'system',     // was 'default'
  KOL = 'kol',
  PERSONAL = 'personal', // new
}
```

DTO `ScenarioSource = 'system' | 'kol' | 'personalized'`.

## Premium Gating Semantics (Option B)

Personal scenarios can be `access_tier='premium'`. Gating is uniform — owner without active subscription is blocked from chatting with their own premium personal scenario. Subscription cancellation = loss of chat access. UX must communicate this.

Implementation: no special-case for owner in `ScenarioAccessService.fetchPublishedScenario` — existing premium check applies.

## Privacy Strategy

No RLS (no per-request `app.user_id` plumbing exists). Replace with three repo helper methods that encode owner filters:

- `findVisibleToUser(userId, scenarioId, languageId)` — `(owner_id IS NULL OR owner_id = userId)`
- `listPublicByType(type, languageId, paging)` — `owner_id IS NULL AND type=?`
- `listPersonalForUser(userId, languageId, paging)` — `owner_id = userId AND type='personal'`

Convention: no service queries `scenarioRepo` raw. Tests assert owner filter in every read path.

## Per-Flow Logic Post-Merge

| Flow | Change |
|---|---|
| `POST /scenario/chat` | `resolveChatScenario` → single `findVisibleToUser` call; drop UserAiScenario fallback |
| `GET /scenarios` | `listPublicByType('system', ...)` |
| `GET /scenarios/personal` | personal: `listPersonalForUser`; KOL: existing JOIN, both filter `owner_id IS NULL` for KOL |
| `GET /scenarios/:id` | single owner-aware lookup; source = type-mapped |
| `POST /scenarios/redeem` | add explicit `type='kol' AND owner_id IS NULL` guard |
| Premium access | owner-aware fetch + uniform premium check (Option B) |
| KOL bundle attach | validate `type='kol' AND owner_id IS NULL` |
| `user_scenario_access` insert | restrict to `type IN ('system','kol')` |
| Future personal generator | insert into `scenarios` with type='personal', owner_id, optional image_url |

## Files Touched

**Delete**
- `src/database/entities/user-ai-scenario.entity.ts`
- export line in `src/database/entities/index.ts`

**Modify**
- `src/database/entities/scenario.entity.ts` — add ownerId, nullable categoryId
- `src/database/entities/scenario-type.enum.ts` — SYSTEM, PERSONAL
- `src/database/database.module.ts` — drop UserAiScenario
- `src/modules/scenario/scenarios.module.ts`
- `src/modules/scenario/scenario-chat.module.ts`
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/services/scenarios-listing.service.ts`
- `src/modules/scenario/services/scenarios-detail.service.ts`
- `src/modules/scenario/services/scenario-access.service.ts` — add helper methods
- `src/modules/scenario/services/scenarios-redeem.service.ts`
- `src/modules/scenario/dto/scenario-personal.dto.ts` — add `imageUrl?`
- `src/modules/scenario/dto/scenario-detail.dto.ts` — source literals
- All five spec files

**New**
- `src/database/migrations/<ts>-merge-user-ai-scenarios-into-scenarios.ts`

## Migration SQL Outline

Postgres requires `ALTER TYPE ... ADD VALUE` to commit before the new value is usable, so the work is split across two migrations.

```sql
-- Migration 1: enum prep (must commit before migration 2)
ALTER TYPE scenario_type RENAME VALUE 'default' TO 'system';
ALTER TYPE scenario_type ADD VALUE IF NOT EXISTS 'personal';

-- Migration 2: schema, backfill, constraint, drop legacy
ALTER TABLE scenarios ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE scenarios ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_scenarios_owner_lang ON scenarios(owner_id, language_id) WHERE type='personal';

INSERT INTO scenarios (id, category_id, language_id, creator_id, owner_id,
                       type, title, description, image_url, difficulty,
                       access_tier, status, order_index, created_at, updated_at)
SELECT id, NULL, language_id, NULL, user_id,
       'personal', title, description, NULL, difficulty,
       'free', 'published', 0, created_at, created_at
FROM user_ai_scenarios
ON CONFLICT (id) DO NOTHING;

ALTER TABLE scenarios ADD CONSTRAINT scenarios_type_owner_check CHECK (
  (type = 'personal' AND owner_id IS NOT NULL AND category_id IS NULL)
  OR
  (type IN ('system','kol') AND owner_id IS NULL AND category_id IS NOT NULL)
);

DROP TABLE user_ai_scenarios;
```

Run with `npm run migration:run -- --transaction each` so each migration commits independently.

## Risks

| Risk | Mitigation |
|---|---|
| Listing leaks another user's personal scenario | Repo helpers + spec tests asserting filter |
| KOL bundle/grant accidentally points at personal | App guard `type='kol'` on insert |
| Direct `scenarioRepo.find*` outside helpers | Convention review |
| Mobile parses `source='default'` literal | App not released — coordinate before any release |
| Premium subscription cancellation locks owner from own personal scenario | Product/UX must communicate ownership ≠ access (Option B) |
| CHECK rejects legitimate insert during dev | Tests cover all three type paths |

## Success Criteria

- `POST /scenario/chat` succeeds for both system, KOL, and personal scenarios.
- Listing endpoints return correct partitions; cross-user personal scenarios never appear.
- KOL redemption flow unchanged for end user.
- Migration runs in single transaction, idempotent down via inverse.
- All scenario specs green with new repo helpers and source literals.

## Next Steps

1. Run `/ck:plan` to break implementation into phases.
2. Confirm mobile-side parser tolerance for `source='system'` before any release cut.
