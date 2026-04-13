# Phase 03: Controller + DTO + Module Wiring

## Context Links
- Reference: `src/modules/ai/ai.controller.ts`, `src/modules/onboarding/onboarding.controller.ts`
- Module: `src/modules/scenario/scenario.module.ts` (if exists) or `src/modules/lesson/lesson.module.ts`

## Overview
- Priority: P1
- Status: complete
- Effort: S (1h)

Expose `ScenarioChatService` via `POST /scenario/chat` with DTO validation, auth, throttle, and module registration.

## Key Insights

- Follow `AiController` pattern: `@UseGuards(ThrottlerGuard)` + `@Throttle(...)` decorators.
- Global JWT guard already applies — no `@Public()` means JWT-protected by default.
- Global `ResponseTransformInterceptor` wraps response in `{code, message, data}` — controller just returns raw DTO.
- Scenario module may not yet exist as a dedicated module (scout showed lesson module handles scenarios). Create `ScenarioModule` only if cleaner; otherwise extend existing module.

## Requirements

**Functional**
- `POST /scenario/chat` accepts validated body, returns response DTO.
- Swagger docs via `@ApiTags`, `@ApiOperation`, `@ApiBody`, `@ApiResponse`.
- Rate limit: 20/min + 100/hr (same as `/ai/chat`).

**Non-functional**
- Controller under 80 lines.
- DTOs use `class-validator` decorators.

## Architecture

### DTOs: `src/modules/scenario/dto/scenario-chat.dto.ts`

```ts
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioChatRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  scenarioId!: string;

  @ApiPropertyOptional({ description: 'Omit for AI-initiated opening (on new conversation only)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class ScenarioChatResponseDto {
  @ApiProperty()
  reply!: string;

  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty()
  turn!: number;

  @ApiProperty()
  maxTurns!: number;

  @ApiProperty()
  completed!: boolean;
}
```

### Controller: `src/modules/scenario/scenario-chat.controller.ts`

```ts
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';

@ApiTags('Scenario Chat')
@ApiBearerAuth()
@Controller('scenario')
@UseGuards(ThrottlerGuard)
export class ScenarioChatController {
  constructor(private readonly service: ScenarioChatService) {}

  @Post('chat')
  @Throttle({ 'ai-short': { limit: 20, ttl: 60_000 }, 'ai-medium': { limit: 100, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Send a turn in a scenario roleplay chat' })
  @ApiResponse({ status: 200, type: ScenarioChatResponseDto })
  async chat(@Req() req: any, @Body() dto: ScenarioChatRequestDto): Promise<ScenarioChatResponseDto> {
    return this.service.chat(req.user.id, dto);
  }
}
```

### Module: `src/modules/scenario/scenario-chat.module.ts` (or extend existing)

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import { AiConversationMessage } from '@/database/entities/ai-conversation-message.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { AiModule } from '@/modules/ai/ai.module';
import { LanguageModule } from '@/modules/language/language.module';
import { SubscriptionModule } from '@/modules/subscription/subscription.module';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioAccessService } from './services/scenario-access.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiConversationMessage, Scenario]),
    AiModule, // for UnifiedLLMService + PromptLoaderService
    LanguageModule,
    SubscriptionModule, // for subscription checks in access service
  ],
  controllers: [ScenarioChatController],
  providers: [ScenarioChatService, ScenarioAccessService],
})
export class ScenarioChatModule {}
```

Register `ScenarioChatModule` in `src/app.module.ts` imports array.

## Related Code Files

**Create**
- `src/modules/scenario/dto/scenario-chat.dto.ts`
- `src/modules/scenario/scenario-chat.controller.ts`
- `src/modules/scenario/scenario-chat.module.ts`

**Modify**
- `src/app.module.ts` — add `ScenarioChatModule` to imports
- `src/modules/ai/ai.module.ts` — verify `UnifiedLLMService` + `PromptLoaderService` are exported (add to `exports` if not)

## Implementation Steps

1. Create DTO file with validators + Swagger decorators.
2. Create controller file exactly as shown.
3. Create module file, verify all imports resolve.
4. Add `ScenarioChatModule` to `app.module.ts`.
5. Verify `AiModule` exports needed services: check `src/modules/ai/ai.module.ts` exports array.
6. `npm run build` — fix any import/provider errors.
7. `npm run start:dev` — hit `/api/docs`, verify `POST /scenario/chat` appears in Swagger.
8. Manual test with curl (JWT token):
```bash
curl -X POST http://localhost:3000/scenario/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenarioId":"<uuid>"}'
```

## Todo List

- [x] Create DTOs with validation + Swagger decorators
- [x] Create `ScenarioChatController`
- [x] Create `ScenarioChatModule` with proper imports/providers
- [x] Register module in `AppModule`
- [x] Verify `AiModule` exports `UnifiedLLMService` + `PromptLoaderService`
- [x] `npm run build` clean
- [x] Swagger shows endpoint at `/api/docs`
- [x] Manual curl test returns 200 with reply

## Success Criteria

- `POST /scenario/chat` returns 200 with valid JWT + scenarioId
- Returns 401 without JWT
- Returns 400 with invalid body (missing scenarioId, bad UUID)
- Returns 403 for premium scenario + free user
- Rate limit enforced (429 after 20 req/min)
- Swagger docs render correctly

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `AiModule` doesn't export services needed | Add to `exports` array in AiModule; already exports `PromptLoaderService` for onboarding per scout |
| Circular dependency between scenario + ai modules | Use forward refs if detected; otherwise imports should be clean |
| Throttler namespace collision | Use distinct throttler keys or reuse existing `ai-short`/`ai-medium` |

## Security Considerations

- Global JWT guard enforces auth; `@Public()` NOT applied
- `req.user.id` typed via JWT strategy — trust boundary
- DTO validation prevents SQL injection / malformed UUIDs
- Throttler prevents abuse / DoS

## Next Steps
- Phase 04: Write tests
