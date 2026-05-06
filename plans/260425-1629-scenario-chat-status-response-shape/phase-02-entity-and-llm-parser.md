# Phase 02 — Entity + LLM Reply Parser

## Context Links
- Brainstorm: `plans/reports/brainstormer-260425-scenario-chat-status-response.md` § B, § C
- Phase 01 migration

## Overview
**Priority:** P1 — required by Phase 03
**Status:** done
**Effort:** 30 min

Add `status` to the `AiConversation` entity. Add a small JSON parser that turns the LLM's structured output into `{ reply, is_end }` with safe fallback.

## Key Insights
- Enum lives in entity file alongside `AiConversationType` for cohesion.
- Parser must NEVER throw — a malformed reply must still produce a usable `reply` string. Log warning so we can monitor prompt drift.
- LLM may wrap JSON in markdown fences (```json ... ```). Strip before parsing.

## Requirements
- Export enum `ScenarioChatStatus { CHATTING, DONE }`.
- `@Column` decorator matching the migration column.
- Parser: pure function, no DI, easy to unit-test.
- Parser fallback: returns `{ reply: raw, is_end: false }` when JSON parse fails or shape mismatch.

## Architecture
- Enum + column in `ai-conversation.entity.ts`.
- Parser as a standalone function in `src/modules/scenario/services/scenario-llm-reply-parser.ts` (single responsibility, easy to test, < 50 lines).

## Related Code Files
**Modify:**
- `src/database/entities/ai-conversation.entity.ts`

**Create:**
- `src/modules/scenario/services/scenario-llm-reply-parser.ts`

## Implementation Steps

1. In `ai-conversation.entity.ts`, add export:
   ```ts
   export enum ScenarioChatStatus {
     CHATTING = 'CHATTING',
     DONE = 'DONE',
   }
   ```

2. Add column to the entity class:
   ```ts
   @Column({
     type: 'enum',
     enum: ScenarioChatStatus,
     enumName: 'scenario_chat_status_enum',
     default: ScenarioChatStatus.CHATTING,
   })
   status!: ScenarioChatStatus;
   ```
   Note: `enumName` matches the type created in migration so TypeORM doesn't try to recreate it.

3. Re-export from `src/database/entities/index.ts` if that barrel exists; verify with `grep "AiConversation" src/database/entities/index.ts`.

4. Create `scenario-llm-reply-parser.ts`:
   ```ts
   import { Logger } from '@nestjs/common';

   export interface ParsedScenarioReply {
     reply: string;
     isEnd: boolean;
   }

   const logger = new Logger('ScenarioLlmReplyParser');

   export function parseScenarioReply(raw: string): ParsedScenarioReply {
     const trimmed = stripFences(raw).trim();
     try {
       const obj = JSON.parse(trimmed) as unknown;
       if (typeof obj === 'object' && obj !== null) {
         const o = obj as Record<string, unknown>;
         const reply = typeof o.reply === 'string' ? o.reply : null;
         if (reply !== null) {
           return { reply, isEnd: o.is_end === true };
         }
       }
     } catch {
       /* fall through */
     }
     logger.warn(`LLM reply not structured JSON; using raw text. preview="${raw.slice(0, 80)}"`);
     return { reply: raw, isEnd: false };
   }

   function stripFences(s: string): string {
     const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
     return fenceMatch ? fenceMatch[1] : s;
   }
   ```

5. Run `npm run build`. Fix any type errors before moving on.

## Todo List
- [x] Add `ScenarioChatStatus` enum + column to entity
- [x] Verify entity registered in `database.module.ts` (already is — no change needed, just confirm)
- [x] Create `scenario-llm-reply-parser.ts`
- [x] `npm run build` passes
- [x] No new lint errors (`npm run lint`)

## Success Criteria
- Entity compiles, TypeORM generates no spurious diff (`npm run migration:generate -- src/database/migrations/check` should produce empty migration).
- Parser handles: pure JSON, fenced JSON, plain text, malformed JSON, non-string reply field.

## Risk Assessment
- **Risk:** TypeORM tries to recreate the enum because `enumName` mismatch. **Mitigation:** Use exact name from migration (`scenario_chat_status_enum`).
- **Risk:** Parser silently swallows real errors. **Mitigation:** `logger.warn` on every fallback; monitorable via Langfuse + log search.

## Security Considerations
- Parser must not `eval` or use unsafe deserialization — `JSON.parse` only.

## Next Steps
- Phase 03 wires the parser + status into `ScenarioChatService`.
