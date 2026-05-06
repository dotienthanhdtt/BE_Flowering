# Phase 03 — Service Refactor: Status Logic + New Response Shape

## Context Links
- Brainstorm: `plans/reports/brainstormer-260425-scenario-chat-status-response.md` § C, § D, § F, § G
- Phase 02 entity + parser

## Overview
**Priority:** P1
**Status:** done
**Effort:** 90 min

Rewrite `ScenarioChatService` to (a) read/write `status` instead of `metadata.completed`, (b) parse the LLM reply with the new parser, (c) compute soft-end OR hard-end, (d) return the new `{ scenario, messages }` shape on chat + GET endpoints.

## Key Insights
- All four query sites that filter on `metadata->>'completed'` must switch to `status`.
- `forceNew` `markActiveAsCompleted` becomes a `status='DONE'` UPDATE.
- The chat method must re-query messages AFTER saving the new pair so the response includes them.
- `turn` semantics: post-save, `Math.floor(messageCount / 2)` = number of completed user+assistant pairs.
- Loading history (used as LLM input) still excludes the just-saved pair — that's intentional and unchanged.

## Requirements
- Replace 5 `metadata.completed` references in `scenario-chat.service.ts` with `status` reads/writes (lines 89, 187, 211, 245, 269, 307).
- Use `parseScenarioReply` after each `llmService.chat()` call.
- Soft-end (`isEnd === true`) OR hard-end (`turn >= maxTurns`) → `status = DONE`.
- After persisting new messages, re-query and return full transcript ASC, including message `id`.
- Response shape from `chat()` and `getConversation()` matches new DTO.
- `listConversations()` items use `status` instead of `completed`.

## Architecture

### chat() flow (revised)
```
verify access → resolve conversation → reject if status=DONE
  → load history → build prompt → call LLM
  → parseScenarioReply(raw)
  → save user msg (if any) + assistant msg
  → recompute turn from messageCount
  → status = (isEnd || turn >= maxTurns) ? DONE : CHATTING
  → save conversation
  → re-query all messages ASC
  → return { scenario, messages }
```

### Done check
```ts
if (conversation.status === ScenarioChatStatus.DONE) {
  throw new BadRequestException('Conversation is completed. Pass forceNew: true to start a new one.');
}
```

### Active-conversation queries
Replace:
```ts
.andWhere(`c.metadata->>'completed' IS DISTINCT FROM 'true'`)
```
with:
```ts
.andWhere('c.status = :active', { active: ScenarioChatStatus.CHATTING })
```

### markActiveAsCompleted
```ts
await this.convoRepo
  .createQueryBuilder()
  .update(AiConversation)
  .set({ status: ScenarioChatStatus.DONE })
  .where('user_id = :userId AND scenario_id = :scenarioId', { userId, scenarioId })
  .andWhere('status = :active', { active: ScenarioChatStatus.CHATTING })
  .execute();
```

## Related Code Files
**Modify:**
- `src/modules/scenario/services/scenario-chat.service.ts`

**Read for context:**
- Phase 02 entity + parser
- `src/database/entities/ai-conversation-message.entity.ts` (for message shape)

## Implementation Steps

1. Add imports:
   ```ts
   import { ScenarioChatStatus } from '@/database/entities/ai-conversation.entity';
   import { parseScenarioReply } from './scenario-llm-reply-parser';
   ```

2. **`chat()`** — replace lines 89, 137-177:
   - Line 89 done-check: `if (conversation.status === ScenarioChatStatus.DONE) throw …`
   - After `llmService.chat()`, parse:
     ```ts
     const raw = await this.llmService.chat(messages, { /* unchanged metadata */ });
     const { reply, isEnd } = parseScenarioReply(raw);
     ```
   - Persist messages (unchanged) but use `reply` not `raw`.
   - Recompute and update status:
     ```ts
     conversation.messageCount += dto.message ? 2 : 1;
     const turnAfter = Math.floor(conversation.messageCount / 2);
     const hardEnd = turnAfter >= maxTurns;
     conversation.status = (isEnd || hardEnd) ? ScenarioChatStatus.DONE : ScenarioChatStatus.CHATTING;
     conversation.metadata = { ...(conversation.metadata ?? {}), maxTurns };
     await this.convoRepo.save(conversation);
     ```
   - After save, fetch transcript:
     ```ts
     const messageRows = await this.msgRepo.find({
       where: { conversationId: conversation.id },
       order: { createdAt: 'ASC' },
     });
     const transcript = messageRows
       .filter(m => m.role === MessageRole.USER || m.role === MessageRole.ASSISTANT)
       .map(m => ({
         id: m.id,
         role: m.role as 'user' | 'assistant',
         content: m.content,
         createdAt: m.createdAt.toISOString(),
       }));
     return {
       scenario: {
         conversationId: conversation.id,
         maxTurns,
         turn: turnAfter,
         status: conversation.status,
       },
       messages: transcript,
     };
     ```

3. **`findOrCreate()`** — replace metadata-based filter with status:
   ```ts
   .andWhere('c.status = :active', { active: ScenarioChatStatus.CHATTING })
   ```
   Drop `metadata: { maxTurns: MAX_TURNS, completed: false }` from `create()`; keep only `metadata: { maxTurns: MAX_TURNS }`. Status defaults to CHATTING via the column default.

4. **`markActiveAsCompleted()`** — rewrite per Architecture above.

5. **`listConversations()`** — replace `completed` field with `status`:
   ```ts
   return {
     items: rows.map((r) => ({
       id: r.id,
       startedAt: r.createdAt.toISOString(),
       lastTurnAt: r.updatedAt.toISOString(),
       turnCount: Math.floor(r.messageCount / 2),
       status: r.status,
       maxTurns: (r.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS,
     })),
   };
   ```
   Note: list endpoint may keep camelCase or shift to snake_case to match new shape. **Decision: keep list as-is for now** unless Phase 04 also reshapes it (recommended).

6. **`getConversation()`** — return new shape:
   ```ts
   return {
     scenario: {
       conversationId: c.id,
       maxTurns,
       turn: Math.floor(c.messageCount / 2),
       status: c.status,
     },
     messages: rows
       .filter(r => r.role === MessageRole.USER || r.role === MessageRole.ASSISTANT)
       .map(r => ({
         id: r.id,
         role: r.role as 'user' | 'assistant',
         content: r.content,
         createdAt: r.createdAt.toISOString(),
       })),
   };
   ```

7. `npm run build` — fix all type errors against new DTO shape (Phase 04 finalizes DTOs but rough types must compile).

## Todo List
- [x] Replace 5 `metadata.completed` query sites with `status` checks
- [x] Wire `parseScenarioReply` into `chat()`
- [x] Compute hardEnd from `messageCount` AFTER save
- [x] Re-query transcript after save in `chat()`
- [x] Update `markActiveAsCompleted` to write `status`
- [x] Update `listConversations` items to expose `status`
- [x] Update `getConversation` to return new shape
- [x] `npm run build` passes
- [x] All `metadata.completed` references gone (`grep -r "metadata.*completed" src/modules/scenario/`)

## Success Criteria
- No reference to `metadata.completed` or `metadata?.['completed']` in `scenario-chat.service.ts`.
- `chat()` returns `{ scenario, messages }` shape (camelCase props internally; @Expose handles wire format in Phase 04).
- Soft-end works: when LLM emits `is_end:true`, conversation flips to DONE on this turn.
- Hard-end works: turn 12 still flips to DONE even without `is_end`.
- `forceNew=true` clears active conversation by status.

## Risk Assessment
- **Risk:** Off-by-one in turn calculation. Today's `currentTurn = floor(history.length/2)+1` is the turn being executed. New `turnAfter = floor(messageCount/2)` post-save is the turn count completed. These should match for the response. **Mitigation:** add a test asserting turn after first user+assistant pair = 1.
- **Risk:** Re-querying transcript adds a DB roundtrip per chat call. **Mitigation:** Acceptable — single indexed query on conversationId. Alternative (build transcript from history + new pair) is bug-prone.
- **Risk:** Forgetting to update `metadata` write of `completed` somewhere. **Mitigation:** grep step in Todo.

## Security Considerations
- DONE check still throws `BadRequestException`. No info leak.
- Owner check in `getConversation` unchanged.

## Next Steps
- Phase 04: lock the DTO shape with `@Expose({ name })` for snake_case wire format.
