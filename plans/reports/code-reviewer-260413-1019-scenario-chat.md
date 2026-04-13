# Code Review: Scenario Chat API (commit 250096a)

**Date:** 2026-04-13
**Reviewer:** code-reviewer
**Branch:** dev
**Scope:** 11 files in `src/modules/scenario/*`, AiConversation entity diff, migration, prompt JSON
**Prior reports:** `brainstorm-260412-2214-scenario-chat-api.md`, `tester-260412-2249-scenario-chat.md`

---

## Verdict: **PASS_WITH_CONCERNS**

Feature is correct for single-request flow, fully spec-compliant with plan phases 01-04, and tests pass (228/228). Two race-condition issues and one auth-ordering subtlety should be addressed before next related feature, but none block merge to `dev`.

---

## Critical (block merge)

None.

---

## Important (fix before next feature in this module)

- **Race in `findOrCreate` → duplicate conversations per (userId, scenarioId).** `scenario-chat.service.ts:118-136`. Two concurrent first-turn requests both see `getOne()=null`, both insert. Migration `1775700000000` creates a non-unique index. Consequences: duplicate scenario conversations, future resume ambiguity, inconsistent turn counters. **Fix:** add partial unique constraint `UNIQUE (user_id, scenario_id) WHERE metadata->>'completed' IS DISTINCT FROM 'true'` OR wrap in `INSERT ... ON CONFLICT DO NOTHING RETURNING *` pattern via `createQueryBuilder().insert()`. KISS option: accept an application-level `advisory_lock(hashtext(userId||scenarioId))` only on create path.

- **Race in message persistence under concurrent turns.** `scenario-chat.service.ts:95-108`. If user double-taps send, two in-flight calls both read history length N, both increment `messageCount` from same base, LLM fires twice, four messages appended with potentially interleaved ordering by `createdAt`. No transaction wraps steps 5-11. **Fix:** optimistic lock via `@VersionColumn` on `AiConversation`, or `SELECT ... FOR UPDATE` inside a transaction between history read and save.

- **`findAccessibleScenario` runs on user-supplied `scenarioId` BEFORE resume validation.** `scenario-chat.service.ts:41-47`. Premium gate is checked against the scenarioId in the request body, not the conversation's stored `scenarioId`. Safe TODAY because line 147 rejects scenarioId mismatch — but if that check is ever weakened/removed, a paying user's conversation could be "hijacked" by sending the victim's `conversationId` with the attacker's free scenarioId. **Fix:** after `resolveExisting`, re-validate access against `conversation.scenarioId`, or swap order: fetch conversation first, then run access check against its persisted scenarioId.

---

## Minor (optional)

- `loadHistory` uses `take: MAX_HISTORY` with `ASC` — returns *oldest* first, not most recent. Works because MAX_TURNS caps at 12 (26 msgs < 26 limit), but fragile to constant changes. Suggest `DESC` + `.reverse()` or document the invariant. (`scenario-chat.service.ts:151-160`)
- Turn counter ambiguity: after an AI-only opener, user's first real message also shows `turn: 1` (same as opener). Client UX may double-render turn 1. Not a bug; consider documenting in Swagger description.
- `dto.message` passes MinLength(1) for whitespace-only strings. Harmless but consider `@Transform` trim + re-validate. (`dto/scenario-chat.dto.ts:13`)
- `resolveExisting` uses plain `findOne({ where: { id } })` then checks `userId` in code. Single-query predicate `{ id, userId }` is more idiomatic, avoids leaking existence of other users' conversation IDs via timing. (`scenario-chat.service.ts:144-146`)
- `BadRequestException('scenarioId mismatch')` leaks internal state — consider generic 404 "Conversation not found" for the mismatch branch to avoid enumeration. (`scenario-chat.service.ts:147`)

---

## Adversarial findings (per-finding verdict)

| # | Attack / edge case | Result | Verdict |
|---|---|---|---|
| 1 | Access another user's conversation via `conversationId` | Rejected by `userId !== userId` check (L146) | **Accept** (safe) |
| 2 | Use valid `conversationId` with attacker's own `scenarioId` to bypass premium gate | Mitigated by scenarioId-mismatch check (L147), but ordering fragility — see Important #3 | **Defer** (works today, brittle) |
| 3 | Missing/null/invalid `scenarioId` | class-validator `@IsUUID` rejects → 400 via ValidationPipe (main.ts global) | **Accept** (safe) |
| 4 | Nonexistent `scenarioId` | NotFoundException from `findAccessibleScenario` | **Accept** (safe) |
| 5 | Prompt injection via user message | User input goes into `HumanMessage`, not template substitution. Template vars are admin/DB-sourced (scenario.title/description/category, language names) — low risk, but scenario admins could inject `{{}}` — not user-exploitable | **Accept** (safe from user, rely on admin trust for scenario content) |
| 6 | Race on concurrent first-turn requests → duplicate conversations | Reproducible, no DB-level guard | **Reject** (see Important #1) |
| 7 | Race on concurrent message sends for same conversation | No transaction/locking around steps 5-11 | **Reject** (see Important #2) |
| 8 | SQL injection via raw query | Only raw fragment is `metadata->>'completed' IS DISTINCT FROM 'true'` — literal constant, no interpolation. Parameter bindings used for userId/scenarioId. | **Accept** (safe) |
| 9 | Rate limit on AI endpoint | `@Throttle({ 'ai-short': 20/min, 'ai-medium': 100/hr })` at controller + ThrottlerModule.forRoot in module | **Accept** (safe, matches CLAUDE.md spec) |
| 10 | Migration breaks existing `ai_conversations` rows | Column added as nullable, no default — existing rows get NULL scenarioId, fine. `down()` reverts symmetrically. | **Accept** (safe) |
| 11 | Entity registration (Railway rule) | `AiConversation` present in both `database.module.ts` (L12,32) AND `scenario-chat.module.ts` forFeature(). `Scenario` + `UserScenarioAccess` also in both. | **Accept** (safe) |
| 12 | Prompt JSON in Docker build | `nest-cli.json` `assets: modules/ai/prompts/**/*` — bundled. | **Accept** (safe) |
| 13 | JWT guard on `/scenario/chat` | `APP_GUARD = JwtAuthGuard` global in `app.module.ts`; controller has no `@Public()` — authenticated by default | **Accept** (safe) |
| 14 | Raw exception leakage | Uses `BadRequestException`/`NotFoundException`/`ForbiddenException`; `AllExceptionsFilter` wraps to `{code, message, data}` | **Accept** (safe) |
| 15 | `messageCount` drift on partial failure after LLM call | If `msgRepo.save` throws after LLM reply generated, user's $ spent on LLM, no message persisted. No compensation. | **Defer** (acceptable tradeoff for MVP, document) |

---

## Spec compliance (plan.md phases 01-04)

- **Phase 01 DB migration** ✓ — `scenario_id` column, FK to `scenarios(id) ON DELETE SET NULL`, partial index for non-null rows.
- **Phase 02 prompt + service** ✓ — JSON prompt in correct location; service handles find-or-create, 12-turn cap, resume, premium gate.
- **Phase 03 controller + DTO + module** ✓ — `POST /scenario/chat`, DTO validated, module wires correctly, ThrottlerGuard matches AiModule pattern.
- **Phase 04 tests** ✓ — 32 new tests cover access, new/resume, completion, language fallback, persistence, LLM interaction. All pass per tester report.
- No unjustified extras.

---

## Verified clean

- Global JWT guard covers route; DTO whitelisting + ValidationPipe active; response format wrapped by interceptor; file sizes all under 200 lines; entity registration matches Railway double-registration rule; prompt JSON bundled in build; migration is reversible; UserLanguageDto / Language shapes match what service accesses; LLM metadata tags conversationId/turn/scenarioId for Langfuse tracing.

---

## Unresolved Questions

1. Is the race-condition risk (duplicate conversations) acceptable for launch, given expected low concurrency per user? Recommend decision documented in phase-01 follow-up.
2. Should `maxTurns` per-conversation override be exposed to clients (currently stored in metadata but not settable)? Plan says YAGNI — confirm.
3. Does the team want a transaction wrapping steps 5-11 to make message persistence atomic with conversation update?
4. For audit: should `completed=true` trigger any downstream (e.g., user progress log, notification)? Plan phase 04-05 don't mention.

---

**Status:** DONE
**Summary:** PASS_WITH_CONCERNS — spec-compliant, tests pass, but two race conditions (duplicate conversation creation, concurrent message persistence) and one auth-ordering fragility should be addressed before the next feature extends this module.
