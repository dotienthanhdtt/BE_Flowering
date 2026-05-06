# Phase 03 — Personalization Module Skeleton

## Context Links
- Brainstorm §5.2, §7
- Phase 01 (schema), Phase 02 (engine)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** New `personalization` module: controller (`/personalization/chat`, `/complete`, `/messages`), service delegating to `IntakeChatEngine`, DTOs, three new prompts. Module wired in `AppModule` and `DatabaseModule`.

## Key Insights
- Pattern mirrors `onboarding` module structure but auth-required (no `@Public()`).
- Prompts are clones of onboarding prompts with `personalize-` prefix and adjusted system instructions (assume known user, focus on deltas).
- Conversation `type=PERSONALIZE_INTAKE`, `userId` populated.

## Requirements
**Functional:**
- `POST /personalization/chat` { conversationId?, message? } → engine turn.
- `POST /personalization/complete` { conversationId } → triggers extract + generate (deferred to phase 04/05/06 for quota+dedup; phase 03 wires plain happy path).
- `GET /personalization/messages?conversationId=` → list messages.
- Auth: standard JWT (no `@Public()`).
- Tier check: at minimum block FREE here (full quota in Phase 04).

**Non-Functional:**
- Files under 200 lines each.
- Module fully self-contained except shared `IntakeChatEngine`.

## Architecture
```
src/modules/personalization/
├── dto/
│   ├── personalize-chat.dto.ts
│   ├── personalize-complete.dto.ts
│   └── personalize-scenario.dto.ts
├── services/
│   └── personalization.service.ts
├── personalization.controller.ts
└── personalization.module.ts

prompts:
src/modules/ai/prompts/personalize-chat-prompt.json
src/modules/ai/prompts/personalize-extraction-prompt.md
src/modules/ai/prompts/personalize-scenarios-prompt.json
```

## Related Code Files
**Modify:**
- `src/app.module.ts` — register PersonalizationModule
- `src/database/database.module.ts` — register Scenario (already), no new entities
- `src/modules/ai/prompt-loader.service.ts` — verify it picks up new prompt files (likely glob-based; check)

**Create:**
- All files in module layout above
- 3 prompt files

**Delete:** none

## Implementation Steps
1. Clone onboarding prompts → personalize-* with adjusted system text. Reference: brainstorm §5.5 "avoid duplicating last 10 titles" — bake into scenarios prompt placeholder.
2. Create DTOs: `PersonalizeChatDto`, `PersonalizeCompleteDto`, `PersonalizeScenarioDto`. Use `class-validator`.
3. Create `PersonalizationService`:
   - `chat(userId, dto)` → engine.runTurn
   - `complete(userId, dto)` → engine.extractProfile + generate + persist scenarios with `type='personal'`, `ownerUserId=userId`
   - `getMessages(userId, conversationId)` → repo query, ownership check
4. Create `PersonalizationController` with three endpoints; use `@CurrentUser()`.
5. Wire `PersonalizationModule`: imports AiModule (engine + UnifiedLLM), TypeOrmModule.forFeature([Scenario, AiConversation, User]).
6. Add tier check stub: throw `ForbiddenException` if `user.accessTier === FREE`. (Quota in Phase 04 replaces stub.)
7. Register in `AppModule`.
8. Verify Swagger lists endpoints at `/api/docs`.
9. `npm run build`.
10. Smoke test via curl with mocked LLM key.

## Todo List
- [ ] 3 prompt files
- [ ] DTOs
- [ ] Service (happy path only)
- [ ] Controller
- [ ] Module wiring
- [ ] AppModule registration
- [ ] Swagger visible
- [ ] Build clean

## Success Criteria
- Authenticated POST returns 200 with conversation reply.
- POST /complete inserts ≥1 row in `scenarios` with `type='personal'` and matching `ownerUserId`.
- GET /messages returns conversation messages, 403 on cross-user access.

## Risk Assessment
- **Prompt drift from onboarding** → pin behavior in tests later (Phase 09).
- **Forgetting `@CurrentUser` ownership check on /messages** → enforce + test.
- **Scenario insertion missing `type='personal'`** → use enum constant, not string literal.

## Security Considerations
- Verify ownership on `/messages` and `/complete` (conversationId must belong to caller).
- FREE tier gate prevents resource consumption from non-paying users.

## Next Steps
- Unblocks Phase 04 (quota replaces FREE stub), Phase 06 (trigger calls service), Phase 08 (pruning hooks insert).
