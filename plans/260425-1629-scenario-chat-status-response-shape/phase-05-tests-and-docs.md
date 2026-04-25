# Phase 05 — Tests + Docs

## Context Links
- Brainstorm: `plans/reports/brainstormer-260425-scenario-chat-status-response.md` § Success Criteria
- All prior phases

## Overview
**Priority:** P1 — gate for merge
**Status:** pending
**Effort:** 45 min

Update existing tests to the new shape, add coverage for soft-end + parser fallback, update API docs and code-standards note.

## Key Insights
- `scenario-chat.service.spec.ts` currently asserts `metadata.completed`, `result.completed`, `result.turn`, `result.reply`. Every assertion changes.
- Need a new unit-test file for the parser (pure function, easy).
- `dto.spec.ts` may assert old DTO shape — check.
- Controller spec — likely fine, assertions rarely on shape internals.

## Requirements
- All existing scenario-chat tests pass against new shape.
- New tests cover:
  - Parser: pure JSON, fenced JSON, plain text fallback, missing `reply` key, `is_end` types.
  - Service: soft-end (LLM `is_end:true`) flips status DONE before reaching maxTurns.
  - Service: hard-end at maxTurns still flips DONE (regression).
  - Service: status check throws when conversation already DONE.
- `docs/api-documentation.md` updated: new payload shape, status enum, soft/hard end semantics.
- `docs/code-standards.md` adds note: scenario-chat endpoints use snake_case (exception to camelCase default).

## Architecture
- Three test files modified, one created.
- Docs: minimal targeted edits, not full rewrites.

## Related Code Files
**Modify:**
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `src/modules/scenario/dto/scenario-chat.dto.spec.ts`
- `src/modules/scenario/scenario-chat.controller.spec.ts`
- `docs/api-documentation.md`
- `docs/code-standards.md`

**Create:**
- `src/modules/scenario/services/scenario-llm-reply-parser.spec.ts`

## Implementation Steps

1. **Parser tests** (`scenario-llm-reply-parser.spec.ts`):
   ```ts
   describe('parseScenarioReply', () => {
     it('parses pure JSON', () => {
       expect(parseScenarioReply('{"reply":"hi","is_end":false}'))
         .toEqual({ reply: 'hi', isEnd: false });
     });

     it('parses fenced JSON', () => {
       const raw = '```json\n{"reply":"hi","is_end":true}\n```';
       expect(parseScenarioReply(raw)).toEqual({ reply: 'hi', isEnd: true });
     });

     it('falls back when not JSON', () => {
       expect(parseScenarioReply('hello there'))
         .toEqual({ reply: 'hello there', isEnd: false });
     });

     it('falls back when reply is missing', () => {
       expect(parseScenarioReply('{"is_end":true}'))
         .toEqual({ reply: '{"is_end":true}', isEnd: false });
     });

     it('treats non-true is_end as false', () => {
       expect(parseScenarioReply('{"reply":"x","is_end":"yes"}'))
         .toEqual({ reply: 'x', isEnd: false });
     });
   });
   ```

2. **Service tests** — replace assertions:
   - `expect(savedCall.metadata.completed).toBe(true)` → `expect(savedCall.status).toBe(ScenarioChatStatus.DONE)`.
   - `expect(result.completed).toBe(true)` → `expect(result.scenario.status).toBe(ScenarioChatStatus.DONE)`.
   - `expect(result.turn).toBe(...)` → `expect(result.scenario.turn).toBe(...)`.
   - `expect(result.reply).toBe(...)` → check `result.messages[result.messages.length - 1].content`.
   - `metadata: { maxTurns: 12, completed: false }` setup → `status: ScenarioChatStatus.CHATTING, metadata: { maxTurns: 12 }`.
   - Mock `llmService.chat` to return JSON: `'{"reply":"...","is_end":false}'`.

3. **Add new service test cases:**
   ```ts
   it('flips status to DONE on soft-end (is_end=true)', async () => {
     // ... arrange convo at turn 3, llm returns {"reply":"bye","is_end":true}
     llmService.chat.mockResolvedValue('{"reply":"Goodbye!","is_end":true}');
     const result = await service.chat(...);
     expect(result.scenario.status).toBe(ScenarioChatStatus.DONE);
   });

   it('rejects when status is already DONE', async () => {
     // ... mock convo with status=DONE
     await expect(service.chat(...)).rejects.toThrow(BadRequestException);
   });
   ```

4. **DTO spec** — update any shape assertions to new keys.

5. **Controller spec** — update `expect(result).toEqual({ ... })` to new shape if present.

6. **`docs/api-documentation.md`** — update the scenario chat section:
   - New request body unchanged.
   - New response body example matching the brainstorm spec.
   - Document `status` values (`CHATTING`, `DONE`).
   - Document end semantics (soft via LLM `is_end`, hard at `max_turns=12`).
   - Note breaking change date.

7. **`docs/code-standards.md`** — add small section:
   ```markdown
   ## Snake_case exception: scenario chat
   `POST /scenario/chat`, `GET /scenario/conversations/:id`, and the conversation list endpoint emit snake_case keys (`conversation_id`, `max_turns`, `created_at`). All other endpoints remain camelCase. New endpoints should default to camelCase unless there is a specific contract reason to deviate.
   ```

8. Run:
   ```bash
   npm run lint
   npm run build
   npm test
   ```
   All green before merge.

## Todo List
- [ ] Parser unit tests added (5 cases)
- [ ] Service spec updated to new shape (all assertions)
- [ ] New service test: soft-end via is_end=true
- [ ] New service test: status=DONE rejection
- [ ] Hard-end at maxTurns regression test still passes
- [ ] DTO spec updated
- [ ] Controller spec updated if needed
- [ ] `docs/api-documentation.md` reflects new shape
- [ ] `docs/code-standards.md` notes snake_case exception
- [ ] `npm run lint` clean
- [ ] `npm run build` clean
- [ ] `npm test` all green

## Success Criteria
- Test suite passes with no skipped tests.
- New test coverage for parser ≥ 90%.
- Soft-end + hard-end + DONE-rejection all covered.
- Docs accurately describe new contract; outdated examples removed.

## Risk Assessment
- **Risk:** Forgetting a stale assertion. **Mitigation:** `grep "completed" src/modules/scenario/**/*.spec.ts` should return zero hits before merge.
- **Risk:** Flaky test from re-query roundtrip. **Mitigation:** mock `msgRepo.find` deterministically per call.

## Security Considerations
- No security-specific tests required. Owner-check tests already exist.

## Next Steps
- Coordinate Flutter PR for response shape change.
- User updates `scenario-chat-prompt.json` to emit `{ reply, is_end }` (out of scope here).
- Run `/ck:journal` after merge.
