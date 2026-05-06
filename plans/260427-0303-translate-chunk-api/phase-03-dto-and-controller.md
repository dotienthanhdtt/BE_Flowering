# Phase 3 — DTO + Controller Route

## Context Links
- Brainstorm: `../reports/brainstorm-260427-0258-translate-chunk-api.md`
- Controller: `src/modules/ai/ai.controller.ts`
- DTO dir: `src/modules/ai/dto/`

## Overview
- **Priority:** P2
- **Status:** complete
- **Effort:** ~30m
Create `TranslateChunkRequestDto` and wire `POST /ai/translate/word` to `TranslationService.translateChunk()`. Apply existing AI rate-limit decorator pattern.

## Key Insights
- New endpoint path `/ai/translate/word` does NOT collide with existing `POST /ai/translate` — NestJS treats them as distinct routes.
- Route is auto-protected by global JWT guard. No `@Public()` — chunk translation requires auth.
- `sourceLang`/`targetLang` are free-form strings (no enum) per latest user decision.

## Requirements
- DTO validates: `messageId` UUID, `sourceLang`/`targetLang` strings ≤ 10, `tapFrom` int ≥ 0, `tapTo` int > 0
- DTO exported from `src/modules/ai/dto/index.ts`
- Swagger annotations present (`@ApiOperation`, `@ApiProperty`)
- Throttle decorator applied matching existing AI endpoints (20/min, 100/hr)

## Architecture
```
POST /ai/translate/word
  ↓ [Global JWT guard] → 401 if no token
  ↓ [Throttle: 20/min, 100/hr]
  ↓ [ValidationPipe → TranslateChunkRequestDto]
  → controller.translateChunk()
  → service.translateChunk()
  → ResponseTransformInterceptor wraps {code:1, message, data}
```

## Related Code Files
**Create:**
- `src/modules/ai/dto/translate-chunk-request.dto.ts`

**Modify:**
- `src/modules/ai/dto/index.ts` (export DTO)
- `src/modules/ai/ai.controller.ts` (new route handler)

## Implementation Steps

### 1. DTO file
```ts
// src/modules/ai/dto/translate-chunk-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class TranslateChunkRequestDto {
  @ApiProperty({ description: 'Source AI chat message id' })
  @IsUUID()
  messageId!: string;

  @ApiProperty({ example: 'en' })
  @IsString()
  @MaxLength(10)
  sourceLang!: string;

  @ApiProperty({ example: 'vi' })
  @IsString()
  @MaxLength(10)
  targetLang!: string;

  @ApiProperty({ example: 4, description: 'Inclusive char index of tap start' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tapFrom!: number;

  @ApiProperty({ example: 5, description: 'Exclusive char index of tap end' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tapTo!: number;
}
```

### 2. Export from DTO index
Add to `src/modules/ai/dto/index.ts`:
```ts
export * from './translate-chunk-request.dto';
```

### 3. Controller route
In `ai.controller.ts`, after the existing `translate` handler:
```ts
@Post('translate/word')
@ApiOperation({ summary: 'Translate a context-aware chunk in a sentence' })
async translateChunk(
  @CurrentUser() user: User,
  @Body() dto: TranslateChunkRequestDto,
) {
  return this.translationService.translateChunk(
    dto.messageId,
    dto.sourceLang,
    dto.targetLang,
    dto.tapFrom,
    dto.tapTo,
    user.id,
  );
}
```
Mirror any throttle decorator used on existing translate route. Inspect `ai.controller.ts` for the exact decorator (`@Throttle(...)` or `@UseGuards(...)`); copy verbatim.

### 4. Module registration
No change — `TranslationService` is already provided in `AiModule`.

## Todo List
- [x] Create `translate-chunk-request.dto.ts`
- [x] Export DTO from `dto/index.ts`
- [x] Add `translateChunk` controller method
- [x] Apply throttle decorator (match existing translate)
- [x] `npm run build` clean
- [x] `npm run start:dev` — Swagger at `/api/docs` shows new endpoint

## Success Criteria
- Swagger UI lists `POST /ai/translate/word` with full schema
- `curl -X POST` without JWT → 401
- `curl` with valid JWT + valid body → 200 with chunk JSON wrapped in `{code:1, ...}`
- Invalid `messageId` → 404; non-owner → 403; out-of-range tap → 400

## Risk Assessment
- **Risk:** Route ordering — NestJS may match `POST /ai/translate/word` against `POST /ai/translate` if order matters. **Mitigation:** NestJS uses exact path match; no conflict expected. Confirm via Swagger after registration.
- **Risk:** Throttle config not picked up. **Mitigation:** copy decorator verbatim from existing `translate` route.

## Security Considerations
- Authed-only (no `@Public()`).
- DTO validation prevents negative/non-int tap values.
- `MaxLength(10)` on lang codes prevents oversized inputs.

## Next Steps
- Phase 4 covers tests + manual smoke.
