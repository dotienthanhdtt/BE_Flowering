---
phase: 1
title: "Backend PUT endpoint + tests"
status: completed
priority: P2
effort: "1.5h"
dependencies: []
---

# Phase 1: Backend PUT endpoint + tests

## Overview

Add `PUT /ai/messages/:messageId/corrected-content` to `AiController`. Validates ownership, updates `ai_conversation_messages.corrected_content`, returns 204. Idempotent.

## Requirements

### Functional
- Endpoint accepts `{ correctedText: string | null }` (max 4000 chars)
- Verifies caller owns the message (via `conversation.userId === req.user.id`)
- UPDATEs `corrected_content` column in single SQL statement
- Returns 204 No Content on success
- Returns 404 if message not found
- Returns 403 if caller doesn't own the message
- Returns 400 if `correctedText` exceeds 4000 chars

### Non-functional
- JWT-protected (no `@OptionalAuth` — only authenticated owners persist)
- Throttled: 10 req/min/user (`ThrottlerGuard` default extended)
- Single DB round-trip ownership + UPDATE (use `UPDATE ... FROM ... WHERE` join or load-then-update with `select: ['id','conversationId']`)

## Architecture

```
PUT /ai/messages/:messageId/corrected-content
  → AiController.persistCorrectedContent(user, messageId, dto)
    → MessageCorrectionService.persistCorrection(userId, messageId, correctedText)
      → loads msg with conversation.userId (single QB join)
      → asserts ownership → throws NotFound/Forbidden
      → UPDATE ai_conversation_messages SET corrected_content = ? WHERE id = ?
```

Service stays small (~30 LOC). Place in `modules/ai/services/message-correction.service.ts` (separate from `LearningAgentService` which is LLM-heavy).

## Related Code Files

### Create
- `src/modules/ai/dto/put-corrected-content.dto.ts` — Request DTO with class-validator
- `src/modules/ai/services/message-correction.service.ts` — Persistence logic + ownership check
- `test/modules/ai/message-correction.service.spec.ts` — Unit tests (mocked repos)
- `test/modules/ai/ai-controller-put-corrected-content.e2e-spec.ts` — E2E test (real DB if available, or supertest with stubbed JWT)

### Modify
- `src/modules/ai/ai.controller.ts` — Add `PUT /ai/messages/:messageId/corrected-content` handler
- `src/modules/ai/ai.module.ts` — Register `MessageCorrectionService` provider; ensure `AiConversationMessage` + `AiConversation` repos available via `TypeOrmModule.forFeature([...])`
- `src/modules/ai/dto/index.ts` — Export new DTO

## Implementation Steps

1. **DTO** — Create `PutCorrectedContentRequestDto`:
   ```ts
   export class PutCorrectedContentRequestDto {
     @ApiProperty({ nullable: true, maxLength: 4000 })
     @IsOptional()
     @ValidateIf((_, v) => v !== null)
     @IsString()
     @MaxLength(4000)
     correctedText!: string | null;
   }
   ```
   Note: `IsOptional` alone won't accept explicit `null` body — use `ValidateIf` to allow null pass-through.

2. **Service** — `MessageCorrectionService.persistCorrection(userId, messageId, correctedText)`:
   - Query: `msgRepo.createQueryBuilder('m').leftJoin('m.conversation', 'c').select(['m.id','c.userId']).where('m.id = :id', {id: messageId}).getRawOne()`
   - If not found → `throw new NotFoundException('Message not found')`
   - If `c_user_id !== userId` → `throw new ForbiddenException()`
   - `msgRepo.update({ id: messageId }, { correctedContent: correctedText })`
   - Return void

3. **Controller** — Add endpoint to `AiController`:
   ```ts
   @Throttle({ default: { limit: 10, ttl: 60_000 } })
   @Put('messages/:messageId/corrected-content')
   @HttpCode(204)
   @ApiOperation({ summary: 'Persist grammar correction on a user message' })
   @ApiParam({ name: 'messageId', format: 'uuid' })
   async persistCorrectedContent(
     @CurrentUser() user: User,
     @Param('messageId', new ParseUUIDPipe()) messageId: string,
     @Body() dto: PutCorrectedContentRequestDto,
   ): Promise<void> {
     await this.messageCorrectionService.persistCorrection(user.id, messageId, dto.correctedText);
   }
   ```
   Note: no `@OptionalAuth()` — user param is non-nullable, JWT global guard enforces.

4. **Module wiring** — In `ai.module.ts`:
   - Add `MessageCorrectionService` to `providers`
   - Add `AiConversationMessage`, `AiConversation` to `TypeOrmModule.forFeature([...])` if not present

5. **Compile check** — `npm run build` from `be_flowering/`. Resolve any TS errors.

6. **Unit tests** (`message-correction.service.spec.ts`):
   - happy path: returns void, calls `update` with correct args
   - not found → `NotFoundException`
   - wrong owner → `ForbiddenException`
   - null correctedText → UPDATE with null (clears existing correction)

7. **E2E test** (`ai-controller-put-corrected-content.e2e-spec.ts`):
   - 204 with valid token + owned message
   - 401 without token
   - 403 with valid token but different user's message
   - 404 with non-existent messageId
   - 400 with `correctedText` > 4000 chars
   - 400 with non-UUID `messageId` (ParseUUIDPipe rejects)

8. **Test run** — `npm test` + `npm run test:e2e`. All pass.

## Todo List

- [ ] Create `put-corrected-content.dto.ts`
- [ ] Create `message-correction.service.ts`
- [ ] Add endpoint to `ai.controller.ts`
- [ ] Wire `MessageCorrectionService` + repos in `ai.module.ts`
- [ ] Export DTO from `dto/index.ts`
- [ ] `npm run build` passes
- [ ] Unit tests written + passing
- [ ] E2E tests written + passing
- [ ] Verify Swagger docs render at `/api/docs`

## Success Criteria

- [ ] `PUT /ai/messages/:uuid/corrected-content` with valid JWT + owned message + `{correctedText:"foo"}` → 204, DB column updated
- [ ] Same endpoint with another user's message → 403
- [ ] Non-existent messageId → 404
- [ ] Body `{correctedText: null}` → 204, column cleared
- [ ] `correctedText` length 4001 → 400
- [ ] All new tests pass; no regression on existing AI controller tests
- [ ] Endpoint visible in Swagger UI

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Ownership check leaks via join SQL injection | Low | Use TypeORM parameterized queries (createQueryBuilder), never string concat |
| Throttle key collides with other AI endpoints | Low | NestJS Throttler keys by route+IP by default; `@Throttle` decorator scopes to this handler |
| ParseUUIDPipe accepts v1/v3/v5 unintentionally | Low | Default accepts all versions — acceptable for this case (message IDs are server-generated v4 only) |
| Forgotten module registration → 500 at runtime | Med | Covered by E2E test on first request; documented in be_flowering CLAUDE.md "Entity Registration" rule |

## Security Considerations

- JWT global guard enforces authentication
- Per-message ownership check prevents IDOR
- Body size bounded by `MaxLength(4000)` matching `corrected_content` text column usage
- Throttling prevents abuse (10/min/user)
- No raw SQL — all queries via TypeORM
