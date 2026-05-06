# Phase 02 — Entity Update

## Context Links
- `brainstorm-summary.md`
- `phase-01-migration.md` (must run first)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Drop `metadata` field, add `maxTurns` and `nativeLanguage` fields on `AiConversation` entity. Wire types so consumers compile against new shape.

## Key Insights
- Entity changes are a breaking type-level signal — TS compiler will surface every consumer of `metadata`. Phases 03/04 fix those.
- `nativeLanguage` is nullable (only set for ANONYMOUS onboarding).
- `maxTurns` is `NOT NULL DEFAULT 12` matching DB column.

## Requirements
- Match column types exactly (Phase 01 schema).
- Keep field naming consistent with codebase (camelCase TS, snake_case column).

## Related Code Files
**Modify:**
- `src/database/entities/ai-conversation.entity.ts`

## Implementation Steps

1. Open `src/database/entities/ai-conversation.entity.ts`.

2. Remove the `metadata` field (lines 78-79):
   ```ts
   @Column({ type: 'jsonb', nullable: true })
   metadata?: Record<string, unknown>;
   ```

3. Add new fields (place near `status` for cohesion):
   ```ts
   @Column({ type: 'int', name: 'max_turns', default: 12 })
   maxTurns!: number;

   @Column({ type: 'varchar', length: 10, name: 'native_language', nullable: true })
   nativeLanguage?: string | null;
   ```

4. Run `npx tsc --noEmit -p tsconfig.json` — expect compile errors at every `conversation.metadata` reference. That list seeds Phases 03/04.

## Todo List
- [ ] Remove `metadata` column declaration
- [ ] Add `maxTurns` column declaration
- [ ] Add `nativeLanguage` column declaration
- [ ] Compile to capture consumer break list

## Success Criteria
- Entity exports `maxTurns` and `nativeLanguage` properties; no `metadata`.
- Compile errors only at expected consumer sites (scenario-chat, onboarding, intake-chat-engine, auth, specs).

## Risk Assessment
- None at the entity level. Compiler-driven cascade.

## Security Considerations
None.

## Next Steps
Phases 03 and 04 in parallel.
