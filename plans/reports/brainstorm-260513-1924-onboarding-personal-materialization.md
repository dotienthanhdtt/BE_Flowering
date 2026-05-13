# Brainstorm Report — Onboarding Scenarios → PERSONAL Materialization

## Problem
`GET /scenarios/personal` returns empty for users who completed onboarding because onboarding stores 5 generated scenarios as JSON on `ai_conversations` row but never inserts them into `scenarios` table. PERSONAL Scenario rows are only created via the separate authenticated `/personalization` intake flow.

**Goal:** After auth links onboarding conversation to user, materialize JSON scenarios into real PERSONAL `Scenario` rows so `/scenarios/personal` returns them.

## Agreed Approach: Schema Simplification + Materialization on Link

### Decision Summary
| Topic | Decision |
|---|---|
| `icon` field | **Remove** from OnboardingScenarioDto |
| `accentColor` field | **Remove** from OnboardingScenarioDto |
| `difficulty` field | **Remove** from `scenarios` table + all DTOs (`/scenarios/personal`, `/scenarios/default`) |
| Idempotency | Reuse onboarding-generated `id` as `Scenario.id` PK |
| DRY | Shared helper in scenario module for building PERSONAL Scenario partial |
| Migration | Single migration on dev branch (drop column outright) |
| Old JSON cache | Tolerate extra fields — materializer reads only `{id, title, description}` |

### Final Output Shape (Onboarding + Scenarios Table Aligned)
```json
{
  "id": "uuid",
  "title": "string",
  "description": "string"
}
```
That's it. Direct map to `scenarios` row (plus `ownerId`, `languageId`, `type=PERSONAL`, defaults for rest).

---

## Changes Required

### 1. Database Migration
- Drop `scenarios.difficulty` column.
- Remove `ScenarioDifficulty` enum from `scenario.entity.ts` if no other usage.
- Reversible `down()`: re-add column with default `'beginner'`.

### 2. Entity / DTO
- `scenario.entity.ts` — drop `difficulty` column + import.
- `scenario-default.dto.ts` — drop `difficulty` field.
- `scenario-personal.dto.ts` — drop `difficulty` field.
- `onboarding-scenario.dto.ts` — drop `icon`, `accentColor`; remove `SCENARIO_ACCENT_COLORS` constant + `ScenarioAccentColor` type.

### 3. Prompt Update
- File: `src/modules/ai/prompts/onboarding-scenarios-prompt.json`
- Update LLM instruction so JSON output contains only `{title, description}` per scenario (id is server-assigned).
- Update few-shot examples / output schema accordingly.

### 4. Onboarding Service
- `onboarding.service.ts:161-181` — `parseScenarios` now produces `Array<{id, title, description}>`. Server-assigns `id` via `randomUUID()` (already does).
- Cache validation at `:114` still works (`scenarios.length === 5`).
- No other logic change.

### 5. Shared Helper (scenario module)
- Create: `src/modules/scenario/helpers/personal-scenario-builder.ts`
- Function: `buildPersonalScenarioPartial(input: { id?: string; title: string; description?: string; ownerId: string; languageId: string; orderIndex?: number; }): Partial<Scenario>`
- Returns: `{ id, type: PERSONAL, ownerId, languageId, title, description, status: PUBLISHED, accessTier: FREE, orderIndex: orderIndex ?? 0, triggersPersonalization: false }`
- Replace inline mapping in:
  - `personalization.service.ts:244-252` (use helper, drop `difficulty`)
  - New onboarding materialization path (below)

### 6. Materialization Step (auth flow)
- Location: `auth.service.ts:374` — new try-block after `bootstrapUserLanguage`, before `nativeLanguage` bootstrap (or parallel — order doesn't matter; all best-effort).
- Function signature: `materializeOnboardingScenarios(userId: string, conversation: AiConversation): Promise<void>`
- Logic:
  1. Read `conversation.scenarios` JSON; coerce to `{id, title, description}[]` (tolerate extra fields → ignore).
  2. Skip if empty / not array / length != 5 (matches current cache validity check).
  3. Map each via shared `buildPersonalScenarioPartial(...)` with `ownerId=userId, languageId=conversation.languageId`. Reuse the JSON `id` as Scenario PK.
  4. `scenarioRepo.upsert(rows, ['id'])` — idempotent via PK collision; orderIndex = array index.
  5. Log warn on failure, never throw (consistent with surrounding bootstrap pattern).
- Module wiring: inject `ScenarioRepository` into `AuthModule` (or create a thin `OnboardingMaterializationService` in scenario module — cleaner, avoids cross-module repo injection).
- **Recommended:** Service in scenario module, exposed through `ScenarioModule`. `AuthModule` imports it.

### 7. Tests
- Update existing scenario listing specs to drop `difficulty` assertions.
- Update onboarding service spec to drop `icon`/`accentColor` assertions.
- Update personalization service spec to drop `difficulty` from expected scenario partial.
- New tests for `OnboardingMaterializationService` / helper:
  - Materializes 5 scenarios with correct fields.
  - Idempotent: second call with same conversation is no-op (PK collision).
  - Skips on malformed/empty JSON.
  - Tolerates old-shape JSON with extra fields.
  - Failure path doesn't throw (logs warn).
- New auth integration test:
  - Sign-in with `conversationId` → after link, user has 5 PERSONAL scenarios.
  - Sign-in twice with same `conversationId` → still 5 (no dup).

### 8. Docs Sync
- Update `docs/system-architecture.md` — add onboarding→personal materialization to data flow section.
- Update `docs/api-documentation.md` — remove `difficulty` from scenario response examples.

---

## Trade-offs Acknowledged

| Trade-off | Decision Rationale |
|---|---|
| Lose icon/accent UI hints | YAGNI — client can derive from index or use defaults; not critical for MVP |
| Lose per-scenario difficulty | All onboarding users are beginners by design; simplifies schema; KISS |
| Auth depends on scenario module | Acceptable; event-emitter pattern is overkill — direct service injection is simpler and codebase doesn't use events extensively elsewhere |
| Drop column on dev branch | OK pre-release; if scenarios.difficulty has prod data already in use, revisit |

---

## Risks

1. **`difficulty` column has consumers I haven't surveyed** — e.g., AI prompt builders, recommendation logic, reporting. Action: grep `difficulty` across `src/` before migration.
2. **Existing cached conversations with old JSON shape might break TypeORM JSON column reads if strictly typed** — mitigated by reading as `Record<string, unknown>` and projecting only needed keys.
3. **Materialization runs but languageId on conversation differs from active language at fetch time** — already handled: `/scenarios/personal` filters by active language; user must switch to onboarding language to see them. Document this.
4. **Module dependency cycle risk** — if `AuthModule` already imports something that imports `ScenarioModule` indirectly. Action: verify before wiring.
5. **PK collision if two users somehow share the same generated `id`** — randomUUID collision probability negligible; PK constraint catches it anyway.

---

## Implementation Order

1. Migration: drop `scenarios.difficulty` column.
2. Entity + DTOs: remove `difficulty`, `icon`, `accentColor`.
3. Prompt: simplify JSON output schema.
4. Shared helper: `buildPersonalScenarioPartial`.
5. Refactor `personalization.service.ts` to use helper.
6. `OnboardingMaterializationService` in scenario module.
7. Wire into `auth.service.ts` link flow.
8. Tests.
9. Docs sync.

---

## Success Metrics
- New user, complete onboarding, sign in with `conversationId` → `GET /scenarios/personal` returns 5 items with `source: 'personalized'`.
- Re-sign with same `conversationId` → still 5 (no dups).
- Existing `/personalization` intake path continues to produce PERSONAL rows correctly (DRY refactor doesn't break it).
- All existing tests pass after `difficulty` removal.

---

## Open / Out of Scope

- **Direct sign-in users (skip onboarding)** — separate concern; not addressed by this change. Need product call on whether to prompt them or auto-seed.
- **Backfill for users who already signed in pre-feature** — not addressed; need separate decision on scope.
- **`/scenarios/default` impact on KOL/SYSTEM scenarios** — losing `difficulty` from default scenarios may affect admin tooling; verify with team.

## Unresolved Questions
1. Are there admin or analytics queries on `scenarios.difficulty`? Need pre-migration grep.
2. Should AccessTier of materialized PERSONAL scenarios be FREE always, or inherit some logic?
3. After materialization, should the conversation `scenarios` JSON be cleared (storage savings) or kept (audit trail)? Recommend keep for now.
