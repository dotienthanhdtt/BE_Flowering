# Phase 04 — DTOs (snake_case) + Controller

## Context Links
- Brainstorm: `plans/reports/brainstormer-260425-scenario-chat-status-response.md` § E, § F
- Phase 03 service returning new internal shape

## Overview
**Priority:** P1
**Status:** pending
**Effort:** 45 min

Define response DTOs for chat + both GET endpoints with snake_case wire format. Verify @Expose actually emits snake_case under the existing `ResponseTransformInterceptor`. If not, fall back to literal snake_case property names.

## Key Insights
- The global `ResponseTransformInterceptor` wraps every response in `{ code, message, data }`. It does NOT call `classToPlain`/`instanceToPlain` — so `@Expose({ name })` likely won't transform unless the controller returns a class instance and we add a `ClassSerializerInterceptor` OR we use `plainToInstance` + `instanceToPlain`.
- **Pragmatic choice:** declare DTO properties as `conversation_id`, `max_turns`, `created_at` literally. Service returns objects matching that shape. Trade-off: TypeScript identifiers are snake_case (mildly ugly) but wire format is guaranteed correct without extra plumbing.
- Swagger renders the literal property name — `@ApiProperty` + literal name is the simplest path.

## Requirements
- New `ScenarioChatResponseDto` shape: `{ scenario, messages }`.
- Same shape reused by `GET /scenario/conversations/:id`.
- `GET /scenario/:scenarioId/conversations` items shift `completed` → `status` (snake_case keys for new fields, keep existing camelCase for already-shipped fields IF list endpoint stays).
- Old DTOs (`ScenarioChatResponseDto` with reply/conversationId/turn/maxTurns/completed) are deleted, not deprecated.

## Architecture

### Approach: literal snake_case property names
```ts
export class ScenarioInfoDto {
  @ApiProperty({ format: 'uuid' })
  conversation_id!: string;

  @ApiProperty()
  max_turns!: number;

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

  @ApiProperty({ description: 'ISO timestamp' })
  created_at!: string;
}

export class ScenarioChatResponseDto {
  @ApiProperty({ type: () => ScenarioInfoDto })
  scenario!: ScenarioInfoDto;

  @ApiProperty({ type: [ScenarioChatMessageDto] })
  messages!: ScenarioChatMessageDto[];
}
```

ESLint may complain about snake_case identifiers. Add a per-class disable comment if needed:
```ts
/* eslint-disable @typescript-eslint/naming-convention */
```

### List endpoint — minimal change
Update `ScenarioConversationListItemDto`:
```ts
// remove: completed: boolean
// add:
@ApiProperty({ enum: ScenarioChatStatus })
status!: ScenarioChatStatus;
```
List item keys stay camelCase (existing convention). Only the new shape uses snake_case.

## Related Code Files
**Modify:**
- `src/modules/scenario/dto/scenario-chat.dto.ts`
- `src/modules/scenario/services/scenario-chat.service.ts` (update return objects to use snake_case keys matching DTOs)
- `src/modules/scenario/scenario-chat.controller.ts` (return type generics only — controller body stays the same)

## Implementation Steps

1. In `scenario-chat.dto.ts`:
   - **Delete** old `ScenarioChatResponseDto` and `ScenarioConversationDetailDto`.
   - **Add** new DTOs from Architecture section above.
   - **Add** import for `ScenarioChatStatus` from entity.
   - **Update** `ScenarioConversationListItemDto`: replace `completed` field with `status: ScenarioChatStatus`.

2. In `scenario-chat.service.ts`:
   - Update `chat()` return value to literal snake_case object:
     ```ts
     return {
       scenario: {
         conversation_id: conversation.id,
         max_turns: maxTurns,
         turn: turnAfter,
         status: conversation.status,
       },
       messages: transcript.map(m => ({
         id: m.id,
         role: m.role,
         content: m.content,
         created_at: m.createdAt,  // already ISO string from Phase 03
       })),
     };
     ```
   - Update `getConversation()` return likewise.
   - Update `listConversations()` items: replace `completed` with `status: r.status`.

3. Update controller method return types to new DTOs:
   ```ts
   async chat(...): Promise<ScenarioChatResponseDto> { ... }
   async getConversation(...): Promise<ScenarioChatResponseDto> { ... }   // same shape now
   ```

4. Update Swagger annotations (`@ApiResponse({ status: 200, type: ScenarioChatResponseDto })`) on both endpoints.

5. `npm run build` and `npm run lint`. Resolve any naming-convention warnings via the eslint-disable comment.

6. Spot-check Swagger at `http://localhost:3000/api/docs` after `npm run start:dev` — confirm payloads render with snake_case keys.

## Todo List
- [ ] Delete old DTOs (don't deprecate)
- [ ] Add new DTOs with literal snake_case property names
- [ ] Update `ScenarioConversationListItemDto.completed` → `status`
- [ ] Service returns objects matching new DTO key names
- [ ] Controller return types updated
- [ ] `@ApiResponse` types updated on both endpoints
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Swagger renders snake_case keys (manual verify)

## Success Criteria
- Postman/curl shows `{ "data": { "scenario": { "conversation_id": "...", ... }, "messages": [...] } }`.
- Both `POST /scenario/chat` and `GET /scenario/conversations/:id` return identical shape.
- List endpoint exposes `status` instead of `completed`.
- Swagger UI accurate.

## Risk Assessment
- **Risk:** Existing Flutter app calls these endpoints and parses old shape. **Mitigation:** Coordinate Flutter PR; document breaking change in `docs/api-documentation.md` (Phase 05).
- **Risk:** ESLint `naming-convention` rule blocks build. **Mitigation:** local file-level disable; rule is style-only.

## Security Considerations
- No security delta — DTOs are output-only and content unchanged.

## Next Steps
- Phase 05: tests + docs.
