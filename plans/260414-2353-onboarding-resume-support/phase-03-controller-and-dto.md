# Phase 03 — Controller GET Endpoint + DTO + Swagger

## Context Links

- Controller: `src/modules/onboarding/onboarding.controller.ts`
- Service: updated in phase-02
- DTO barrel: `src/modules/onboarding/dto/index.ts`
- GET pattern reference: `src/modules/scenario/scenario-chat.controller.ts:37-47`
- Plan: `plan.md`

## Overview

- Priority: P1
- Status: pending
- Wire `GET /onboarding/conversations/:conversationId/messages` → `OnboardingService.getMessages`.
- New response DTO for Swagger documentation (not enforced at runtime; interceptor handles snake_case).

## Key Insights

- Global `ResponseTransformInterceptor` auto-converts camelCase keys → snake_case. No `@Expose` or manual mapping needed.
- Global JWT guard active — MUST use `@Public()` decorator.
- `OnboardingThrottlerGuard` is class-level `@UseGuards` on controller → automatically applied to new route. 30/hr branch applies (no body, so `hasConversationId` is false → 5/hr. **ISSUE:** see risk).

## Requirements

**Functional:**
- `GET /onboarding/conversations/:conversationId/messages` returns DTO from `service.getMessages`.
- `ParseUUIDPipe` validates path param.
- 404 if conv missing or non-anonymous (thrown by service).
- Public (no JWT).

**Non-functional:**
- Throttling applied.
- Swagger docs with example + error responses.

## Architecture

```
Controller
  @Public @Get('conversations/:conversationId/messages')
    ParseUUIDPipe(:conversationId)
    → OnboardingService.getMessages(id)
    → Interceptor wraps in { code, message, data } + toSnakeCase
```

## Related Code Files

**Create:**
- `src/modules/onboarding/dto/onboarding-messages-response.dto.ts`

**Modify:**
- `src/modules/onboarding/onboarding.controller.ts`
- `src/modules/onboarding/dto/index.ts` (export new DTO)

## Implementation Steps

### Step 1 — Create response DTO (Swagger-only, camelCase; interceptor emits snake_case)

`src/modules/onboarding/dto/onboarding-messages-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  role!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class OnboardingMessagesResponseDto {
  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  turnNumber!: number;

  @ApiProperty()
  maxTurns!: number;

  @ApiProperty()
  isLastTurn!: boolean;

  @ApiProperty({ type: [OnboardingMessageDto] })
  messages!: OnboardingMessageDto[];
}
```

### Step 2 — Export from `dto/index.ts`

```ts
export * from './onboarding-chat.dto';
export * from './onboarding-complete.dto';
export * from './onboarding-scenario.dto';
export * from './onboarding-messages-response.dto';  // new
```

### Step 3 — Add controller route

In `onboarding.controller.ts`:

```ts
import { Get, Param, ParseUUIDPipe } from '@nestjs/common';
// ...existing imports + new DTO

  @Public()
  @Get('conversations/:conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fetch transcript of an anonymous onboarding conversation (for resume UX)',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation transcript with turn metadata',
    type: OnboardingMessagesResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Conversation not found or not anonymous' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async getMessages(@Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.onboardingService.getMessages(conversationId);
  }
```

### Step 4 — Verify throttler behavior

- `OnboardingThrottlerGuard.handleRequest` reads `body.conversationId` → GET has no body → treated as "creation" branch → **5/hr limit**.
- **This is wrong for a read endpoint.** Fix: widen the guard to also treat URL param `conversationId` as "has conversation" → apply 30/hr.

Patch `src/modules/onboarding/onboarding-throttler.guard.ts`:

```ts
const bodyHasId = !!httpReq.body?.conversationId;
const paramHasId = !!httpReq.params?.conversationId;
const hasConversationId = bodyHasId || paramHasId;
```

Rationale: keeps 5/hr only for true session-creation (POST /chat with no ID). GET with param is a cheap read — 30/hr is correct.

### Step 5 — Compile

`npm run build` → 0 TS errors.

### Step 6 — Manual smoke

```bash
# 1. Start conversation
curl -X POST http://localhost:3000/onboarding/chat \
  -H 'Content-Type: application/json' \
  -d '{"nativeLanguage": "vi", "targetLanguage": "en"}'

# Copy conversation_id from response. Then:
curl http://localhost:3000/onboarding/conversations/<conv-id>/messages
```

Expect 200 + snake_case body, single assistant message.

## Todo List

- [ ] Create `onboarding-messages-response.dto.ts`
- [ ] Export from `dto/index.ts`
- [ ] Add `@Get('conversations/:conversationId/messages')` to controller
- [ ] Widen throttler guard to check `params.conversationId`
- [ ] `npm run build` passes
- [ ] Manual smoke: POST /chat, then GET /messages, verify snake_case response

## Success Criteria

- `GET /onboarding/conversations/:id/messages` returns 200 + snake_case `{conversation_id, turn_number, max_turns, is_last_turn, messages: [...]}`
- Invalid UUID path → 400 (ParseUUIDPipe)
- Non-existent UUID → 404 (NotFoundException from service)
- Swagger `/api/docs` shows new endpoint with example
- Throttler applies 30/hr (not 5/hr) to GET

## Risk Assessment

- **Risk:** Throttler guard currently treats any request without `body.conversationId` as "creation" (5/hr). Without widening, GET hits 5/hr immediately. **Mitigation:** patch guard in Step 4.
- **Risk:** Route ordering — `conversations/:conversationId/messages` is specific enough that NestJS won't confuse with other routes. No existing `GET /onboarding/*` routes.
- **Risk:** `ParseUUIDPipe` strict v4 matching may reject valid UUIDs with other versions. **Mitigation:** `AiConversation.id` is `uuid_generate_v4()` (TypeORM default) — safe.

## Security Considerations

- `@Public()` OK: `conversation_id` is UUID v4 (122-bit entropy, unguessable).
- Service enforces ANONYMOUS filter → authenticated convs can't leak via this endpoint.
- Throttler prevents enumeration + abuse.
- Response omits internal fields (`metadata`, token counts).

## Next Steps

Phase 04 tests, Phase 05 docs.
