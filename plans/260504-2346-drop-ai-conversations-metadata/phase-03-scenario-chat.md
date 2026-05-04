# Phase 03 — Scenario-Chat Service Refactor

## Context Links
- `brainstorm-summary.md`
- `phase-02-entity.md`
- Original bug fix this supersedes: `src/modules/scenario/services/scenario-chat.service.ts:187-192` (current `metadata.completed` writes)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Replace all `conversation.metadata` reads/writes in scenario chat with `maxTurns` column reads and `status`-based completion semantics.

## Key Insights
- The DONE-resurrection bug previously patched via `metadata.completed = true` is replaced by the new partial unique index keyed on `status`. No `completed` flag needed anywhere.
- `MAX_TURNS` constant (currently 12) becomes the default for new conversations.

## Requirements
- Preserve current behavior: existing conversations with non-default `maxTurns` (none in prod, but possible) continue to use their stored value via the new column.
- `findOrCreate` must continue to filter out DONE conversations (already done in earlier fix).

## Related Code Files
**Modify:**
- `src/modules/scenario/services/scenario-chat.service.ts`

**Modify (tests):**
- `src/modules/scenario/services/scenario-chat.service.spec.ts`

## Implementation Steps

1. **`scenario-chat.service.ts:104`** — replace:
   ```ts
   const maxTurns = (conversation.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;
   ```
   with:
   ```ts
   const maxTurns = conversation.maxTurns ?? MAX_TURNS;
   ```

2. **`scenario-chat.service.ts:187-193`** — replace the metadata write block:
   ```ts
   const becomingDone = isEnd || hardEnd;
   conversation.status = becomingDone ? ScenarioChatStatus.DONE : ScenarioChatStatus.CHATTING;
   conversation.metadata = {
     ...(conversation.metadata ?? {}),
     maxTurns,
     ...(becomingDone ? { completed: true } : {}),
   };
   ```
   with:
   ```ts
   conversation.status = isEnd || hardEnd ? ScenarioChatStatus.DONE : ScenarioChatStatus.CHATTING;
   ```
   (No metadata write. `maxTurns` was already set on creation; never mutated after.)

3. **`findOrCreate` (around line 272-280)** — set `maxTurns` on creation, drop `metadata`:
   ```ts
   const inserted = await this.convoRepo.save(
     this.convoRepo.create({
       userId,
       scenarioId,
       languageId,
       type: AiConversationType.AUTHENTICATED,
       topic: 'scenario_roleplay',
       maxTurns: MAX_TURNS,
     }),
   );
   ```

4. **`getConversation` (line 351) and `listConversations` (line 331)** — replace:
   ```ts
   const maxTurns = (c.metadata?.['maxTurns'] as number | undefined) ?? MAX_TURNS;
   ```
   with:
   ```ts
   const maxTurns = c.maxTurns ?? MAX_TURNS;
   ```

5. **Spec file `scenario-chat.service.spec.ts`** — replace fixture `metadata: { maxTurns: 12 }` with `maxTurns: 12` (and `metadata: { maxTurns: 12, completed: true }` with `maxTurns: 12, status: ScenarioChatStatus.DONE` where applicable). Approximately 3 fixture blocks at lines 314, 346, 369.

6. Run `npx tsc --noEmit -p tsconfig.json` — clean for this file.

7. Run `npm test -- scenario-chat.service.spec`.

## Todo List
- [ ] Replace `metadata.maxTurns` reads with `maxTurns` column
- [ ] Remove `metadata` writes in chat() turn-end
- [ ] Set `maxTurns: MAX_TURNS` on `findOrCreate` insert
- [ ] Update `getConversation` / `listConversations` reads
- [ ] Update spec fixtures
- [ ] Run scenario-chat spec

## Success Criteria
- No `metadata` references in `scenario-chat.service.ts`.
- All scenario-chat tests pass.
- Behavior preserved: `turn`, `max_turns`, `status` in API response unchanged.

## Risk Assessment
- **Existing conversations** where the row was created before Phase 01 backfill — `maxTurns` will be 12 from default + backfill. Verified safe.
- **Concurrent deploy** — N/A; assume coordinated migration + code release.

## Security Considerations
None.

## Next Steps
Run alongside Phase 04. Phase 05 tests both.
