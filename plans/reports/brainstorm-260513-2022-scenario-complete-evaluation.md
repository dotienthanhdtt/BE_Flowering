# Brainstorm: Scenario `/complete` API with Evaluation

**Date:** 2026-05-13 20:22
**Branch:** dev
**Status:** Design approved, ready for planning

---

## Problem Statement

Today, scenario chat marks `AiConversation.status = DONE` implicitly inside `ScenarioChatService.chat()` when either:
- LLM emits `[END]` marker, or
- `messageCount / 2 >= maxTurns` (12-turn cap)

Gaps:
- Client cannot **force-finish** a scenario (no "End conversation" button server-side).
- No **post-scenario evaluation** (score, feedback, vocab usage) — missing user value.
- `personalizationTrigger.maybeTrigger()` is buried inside chat flow → hard to test/replay/extend.

## Goal

New endpoint: `POST /scenario/complete` that:
1. Marks conversation DONE (idempotent).
2. Runs LLM evaluation of the transcript.
3. Persists evaluation in dedicated table.
4. Triggers personalization (single entry point — moved from chat).
5. Returns transcript + evaluation.

---

## Evaluated Approaches

### Storage: JSONB column vs dedicated table

| | JSONB on `ai_conversations` | Dedicated `scenario_evaluations` table |
|---|---|---|
| Migration cost | Tiny | Migration + entity + 2 module registrations |
| Queryability | JSON extraction, slow | Pure SQL, indexable |
| Foreign keys | None | FK to user/scenario/conversation, cascade |
| Idempotency | App-level check | DB-level `UNIQUE(conversation_id)` |
| Analytics (avg score, leaderboard) | Painful | Trivial |
| Schema evolution | Loose | Versioned (`prompt_version`) |

**Chosen: dedicated table.** Future analytics + DB-enforced idempotency justify the cost.

### Personalization trigger location

| | Stay in chat | Move to `/complete` only | Dual-fire |
|---|---|---|---|
| Single source of truth | ❌ | ✅ | ❌ |
| Risk of double-trigger | Low (advisory lock) | None | Wasteful DB tx |
| Test isolation | Hard | Easy | Hard |
| Client coupling | None | Client must call `/complete` | None |

**Chosen: move to `/complete` only.** Client always calls `/complete` (mandated by contract).

### Sync vs async evaluation

| | Sync (in-request LLM) | Async (queue + poll) |
|---|---|---|
| UX | 2-5s wait on results screen | Need polling/WS |
| Implementation | Simple | Queue infra |
| Failure replay | Just re-call `/complete` | Job state machine |

**Chosen: sync.** YAGNI on queues until p95 latency complains.

---

## Final Design

### Endpoint

```
POST /scenario/complete
Headers: Authorization: Bearer ..., X-Learning-Language: <code>
Body: { conversationId: string, scenarioId: string }
Guard: ResourceAccessGuard + RequireResourceAccess('scenario', bodyKey:'scenarioId')
Throttle: 30/min (no LLM-tier bucket, this is heavier than chat per call)
```

### Flow

```
1. Resolve scenario via ScenarioAccessService (404/403/400 as chat does)
2. Resolve conversation (404 not-found, 403 wrong-user, 400 scenarioId mismatch)
3. SELECT scenario_evaluations WHERE conversation_id = ?
   → if exists: return cached { scenario, messages, evaluation } (no LLM, idempotent)
4. If conversation.status !== DONE:
     conversation.status = DONE
     conversation.completedAt = now()
     save
5. Run evaluator LLM (sync):
     - load transcript (loadHistory)
     - load injected vocab (resolveInjectedVocabulary)
     - load VocabularyInjectionEvent rows for usage hits
     - prompt: scenario-evaluation-prompt.json
     - 9router primary → Gemini fallback (reuse invokeLlmWithFallback pattern)
6. INSERT INTO scenario_evaluations ... ON CONFLICT (conversation_id) DO NOTHING
   (RETURNING * or SELECT after)
7. Fire-and-forget: personalizationTrigger.maybeTrigger(userId, scenarioId)
   ← REMOVED from ScenarioChatService.chat()
8. Return { scenario, messages, evaluation } or { ..., evaluation: null, evaluation_error: '...' } on LLM failure
```

### Schema

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
  vocab_usage     jsonb,        -- [{vocabId, word, used, contextSnippet}]
  model_used      varchar(64) NOT NULL,
  prompt_version  smallint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_eval_user_created ON scenario_evaluations(user_id, created_at DESC);
CREATE INDEX idx_scenario_eval_scenario ON scenario_evaluations(scenario_id);
```

Plus migration on `ai_conversations`: add `completed_at timestamptz NULL`.

### Score Dimensions (LLM output)

- `overall_score` — 0-100 headline
- `fluency_score` — natural flow, sentence variety
- `accuracy_score` — grammar correctness
- `vocab_score` — use of injected target words

Each dimension 0-100. Plus `strengths[]`, `improvements[]`, `summary`, `vocab_usage[]`.

### Failure modes

| Failure | Response |
|---|---|
| Scenario not accessible | 404 |
| Conversation not found | 404 |
| Wrong user | 403 |
| scenarioId mismatch | 400 |
| Already evaluated | 200 + cached evaluation (idempotent replay) |
| LLM evaluator fails | 200 + `evaluation: null` + `evaluation_error` flag; `status=DONE` stays; retryable |
| Personalization trigger fails | swallowed (fire-and-forget, logged) |

---

## Files Affected

**New:**
- `src/database/entities/scenario-evaluation.entity.ts`
- `src/database/migrations/{ts}-create-scenario-evaluations.ts`
- `src/modules/scenario/services/scenario-complete.service.ts` (new — keeps chat service lean)
- `src/modules/scenario/services/scenario-evaluator.service.ts` (LLM call + prompt assembly)
- `src/modules/scenario/dto/scenario-complete.dto.ts`
- `src/modules/scenario/dto/scenario-evaluation.dto.ts`
- `src/modules/ai/prompts/scenario-evaluation-prompt.json`
- Spec files for both services

**Modified:**
- `src/modules/scenario/scenario-chat.controller.ts` → add `@Post('complete')` (or new sub-controller)
- `src/modules/scenario/scenario-chat.module.ts` → register new services + entity
- `src/modules/scenario/services/scenario-chat.service.ts` → **remove** personalizationTrigger call (lines 228-236)
- `src/database/database.module.ts` → register `ScenarioEvaluation` entity globally
- `src/modules/scenario/scenarios.module.ts` → if scenario module owns it, add to forFeature
- `docs/api-documentation.md` → document new endpoint

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Chat path flips DONE without evaluation if client skips `/complete` | Contract: client MUST call `/complete`. v2: lazy-eval on `GET conversation` if `status=DONE && no eval row`. |
| LLM cost spike | Feature flag `SCENARIO_EVAL_ENABLED`; sync eval = no runaway batches. |
| Latency stacking (chat LLM → complete LLM back-to-back) | Client calls `/complete` only after rendering final assistant message; perceived latency hides on results-screen transition. |
| Entity registration miss | Per CLAUDE.md: register in BOTH `database.module.ts` and module-level `TypeOrmModule.forFeature`. |
| Re-evaluation needed (prompt changes) | v1: not supported. v2: add `?force=true` param + new row keyed by `prompt_version`. |

---

## Success Criteria

- `POST /scenario/complete` returns evaluation within p95 < 5s.
- Idempotent: 5x repeat calls → 1 DB row, 1 LLM call.
- Personalization triggers exactly once per qualifying completion.
- Chat path no longer references `personalizationTrigger`.
- All new code paths covered by unit specs (idempotency, replay, LLM failure, guards).

---

## Open Questions

- Should evaluation be visible in conversation history list (`GET /scenarios/:id/conversations`)? — Product decision, suggest yes (show score badge). -> no
- Re-evaluation policy when prompt version bumps? Defer to v2. -> no
- Client UX: how is user expected to invoke `/complete`? Auto-call after `[END]` is detected client-side, OR explicit "Finish & Review" button? — Mobile team decision. -> using button

---

## Next Step
Invoke `/ck:plan` with this brainstorm as context to generate phased implementation plan under `plans/260513-2022-scenario-complete-evaluation/`.
