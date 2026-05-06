# Brainstorm Report — Scenario Chat: Status Column + New Response Shape

**Date:** 2026-04-25
**Author:** brainstormer
**Scope:** `POST /scenario/chat`, `GET /scenario/conversations/:id`, `GET /scenario/:scenarioId/conversations`
**Files of interest:**
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/dto/scenario-chat.dto.ts`
- `src/modules/scenario/scenario-chat.controller.ts`
- `src/database/entities/ai-conversation.entity.ts`
- `src/modules/ai/prompts/scenario-chat-prompt.json`
- `src/modules/ai/services/unified-llm.service.ts`

---

## Problem Statement

Two coupled changes to scenario chat:

1. **Replace `metadata.completed` with a real `status` enum column** (`CHATTING`/`DONE`). Status is set on first message; transition to `DONE` is decided by:
   - **Soft end:** LLM returns `is_end: true` in its structured reply.
   - **Hard end:** turn count reaches `max_turns` (12).
2. **Reshape responses** for chat + GET endpoints to match:
   ```json
   {
     "scenario": { "conversation_id", "max_turns", "turn", "status" },
     "messages": [ { "id", "role", "content", "created_at" } ]
   }
   ```
   Messages ordered ASC (oldest → newest). Snake_case keys for these endpoints only.

---

## Current State (baseline)

- Completion stored in `metadata.completed` (jsonb). Auto-completes when `currentTurn >= maxTurns`.
- `forceNew=true` flips active rows to `metadata.completed=true`.
- `POST /scenario/chat` returns `{ reply, conversationId, turn, maxTurns, completed }` — only the latest reply, camelCase.
- `GET /scenario/conversations/:id` returns full transcript (already ASC), `completed: boolean`.
- `GET /scenario/:scenarioId/conversations` returns list items with `completed: boolean`.
- `UnifiedLLMService.chat()` returns plain string — no structured output today.

---

## Final Design

### A. Database Migration

```sql
CREATE TYPE scenario_chat_status AS ENUM ('CHATTING', 'DONE');

ALTER TABLE ai_conversations
  ADD COLUMN status scenario_chat_status NOT NULL DEFAULT 'CHATTING';

UPDATE ai_conversations
SET status = CASE
  WHEN metadata->>'completed' = 'true' THEN 'DONE'::scenario_chat_status
  ELSE 'CHATTING'::scenario_chat_status
END;

UPDATE ai_conversations SET metadata = metadata - 'completed';   -- drop legacy key
```

Down: drop column, drop type, restore `metadata.completed` from `status`.

**Note on shared table:** `ai_conversations` also stores onboarding (anonymous) rows. The `status` column is benign for them — they default to `CHATTING` and onboarding code never reads it.

### B. Entity Update

```ts
// ai-conversation.entity.ts
export enum ScenarioChatStatus {
  CHATTING = 'CHATTING',
  DONE = 'DONE',
}

@Column({ type: 'enum', enum: ScenarioChatStatus, default: ScenarioChatStatus.CHATTING })
status!: ScenarioChatStatus;
```

Remove the `metadata.completed` reads/writes throughout the codebase (search and replace).

### C. LLM Structured Output

Update `scenario-chat-prompt.json` (user will do later) to require:
```json
{ "reply": "<assistant text>", "is_end": false }
```

Server parsing layer (in `scenario-chat.service.ts`):
```ts
function parseLlmReply(raw: string): { reply: string; is_end: boolean } {
  try {
    const obj = JSON.parse(extractJson(raw));
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : raw,
      is_end: obj.is_end === true,
    };
  } catch {
    return { reply: raw, is_end: false };   // fallback: treat as non-JSON, continue
  }
}
```

`extractJson` strips markdown fences if present. Logger warns on fallback so we can monitor prompt quality.

### D. Status Transition

```ts
const { reply, is_end } = parseLlmReply(rawLlmOutput);
const softEnd = is_end;
const hardEnd = currentTurn >= maxTurns;

// persist messages
await this.msgRepo.save([userMsgIfAny, assistantMsg]);

conversation.status = (softEnd || hardEnd) ? ScenarioChatStatus.DONE : ScenarioChatStatus.CHATTING;
conversation.messageCount += dto.message ? 2 : 1;
conversation.metadata = { ...(conversation.metadata ?? {}), maxTurns };  // keep maxTurns for now
await this.convoRepo.save(conversation);
```

### E. Response DTO (snake_case via @Expose)

```ts
export enum ScenarioChatStatus { CHATTING = 'CHATTING', DONE = 'DONE' }

export class ScenarioInfoDto {
  @Expose({ name: 'conversation_id' })
  @ApiProperty({ name: 'conversation_id', format: 'uuid' })
  conversationId!: string;

  @Expose({ name: 'max_turns' })
  @ApiProperty({ name: 'max_turns' })
  maxTurns!: number;

  @ApiProperty()
  turn!: number;

  @ApiProperty({ enum: ScenarioChatStatus })
  status!: ScenarioChatStatus;
}

export class ScenarioChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty()
  content!: string;

  @Expose({ name: 'created_at' })
  @ApiProperty({ name: 'created_at' })
  createdAt!: string;
}

export class ScenarioChatResponseDto {
  @ApiProperty({ type: () => ScenarioInfoDto })
  scenario!: ScenarioInfoDto;

  @ApiProperty({ type: [ScenarioChatMessageDto] })
  messages!: ScenarioChatMessageDto[];
}
```

**Caveat:** `@Expose({ name })` only renames during transformation if `ClassSerializerInterceptor` (or `transform: true` + `plainToInstance`) processes the response. If the response interceptor passes plain objects through, declare property names literally as snake_case in the DTO instead. Verify locally on first compile.

### F. Endpoints — uniform new shape

| Endpoint | Old payload | New payload |
|---|---|---|
| `POST /scenario/chat` | `{ reply, conversationId, turn, maxTurns, completed }` | `{ scenario, messages }` |
| `GET /scenario/conversations/:id` | `{ id, scenarioId, completed, turn, maxTurns, messages: [{role, content, createdAt}] }` | `{ scenario, messages }` |
| `GET /scenario/:scenarioId/conversations` | items with `completed` | items with `status` |

`turn` semantics across all three: `Math.floor(messageCount / 2)` after save (number of completed user+assistant pairs).

`messages` always ordered `created_at ASC`, system rows filtered out, message `id` exposed.

### G. Behavior Changes

- **Reject DONE conversation:** `if (conversation.status === DONE) throw 400 'completed; pass forceNew'` — same behavior, new read path.
- **forceNew flow:** `markActiveAsCompleted` updates `status = 'DONE'` instead of metadata.
- **No more auto-end before maxTurns:** soft end is now LLM-driven, not turn-driven (until prompt is updated, only hard end fires — equivalent to current behavior).

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM returns malformed JSON → reply lost | Parser fallback returns raw string as `reply`, `is_end=false`. Log warning. |
| Snake_case @Expose silently ignored | Smoke test response in dev before merge. Fall back to declaring snake_case property names directly. |
| `metadata.completed` referenced elsewhere | Grep before deploy: `metadata.completed`, `'completed'`, `metadata?.['completed']`. Migrate all readers. |
| Flutter client breaks on shape change | Coordinate release: BE deploy + FE update in same window. Consider API version bump if app-store rollout matters. |
| Onboarding rows have `status='CHATTING'` forever | Cosmetic only — onboarding code never reads it. Document in entity comment. |

---

## Out of Scope

- LLM prompt update (user will do separately).
- API versioning (`/v2/scenario/chat`) — current consumer is single-app, coordinated deploy is acceptable.
- Renaming the entity to scope it to scenarios — the table is shared with onboarding by design.
- Migrating other endpoints to snake_case — explicitly scenario-only per user decision.

---

## Success Criteria

- `ai_conversations.status` column exists, backfilled correctly, `metadata.completed` removed.
- `POST /scenario/chat` returns `{ scenario: { conversation_id, max_turns, turn, status }, messages: [...] }`.
- Messages array ordered ASC with `id`, `role`, `content`, `created_at`.
- LLM `is_end: true` flips status to `DONE`; reaching `maxTurns` also flips to `DONE`.
- GET endpoints return the same `{ scenario, messages }` shape.
- All existing scenario-chat tests updated and green; new tests cover soft-end and JSON parse fallback.
- Swagger at `/api/docs` reflects new shape.

---

## Next Steps

1. User confirms this report.
2. Run `/ck:plan` to produce phase files (migration, entity, parser, DTO, controller, GET endpoints, tests, Flutter coordination note).
3. Implement per plan; run `npm run build` + `npm test` after each phase.
4. Update `docs/api-documentation.md` and `docs/code-standards.md` (snake_case exception note).

---

## Unresolved Questions

- None at this point (user confirmed: apply to GETs, JSON parse fallback continues, drop `metadata.completed` in same migration).