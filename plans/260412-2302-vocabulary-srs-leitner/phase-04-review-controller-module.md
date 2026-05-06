# Phase 04: Review Controller + DTOs + Module Wiring

## Context Links
- Reference: `src/modules/ai/ai.controller.ts`, `src/modules/onboarding/onboarding.controller.ts`

## Overview
- Priority: P1
- Status: pending
- Effort: S (1h)

Expose `VocabularyReviewService` via `/vocabulary/review/*` endpoints. Wire full `VocabularyModule`.

## Requirements

**Functional**
- Three endpoints: `/vocabulary/review/start`, `/vocabulary/review/:sessionId/rate`, `/vocabulary/review/:sessionId/complete`.
- All JWT-protected.
- DTOs validated via `class-validator`.
- Swagger-documented.

**Non-functional**
- Controller < 80 lines.
- Module wires all providers + controllers from Phases 02 + 03.

## Architecture

### DTOs: `src/modules/vocabulary/dto/`

**review-start.dto.ts**
```ts
export class ReviewStartDto {
  @IsOptional() @IsString() @Length(2, 10)
  languageCode?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;
}

export class ReviewCardDto {
  vocabId!: string;
  word!: string;
  translation!: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string;
  examples?: string[];
  box!: number;
  sourceLang!: string;
  targetLang!: string;
}

export class ReviewStartResponseDto {
  sessionId!: string;
  cards!: ReviewCardDto[];
  total!: number;
}
```

**review-rate.dto.ts**
```ts
export class ReviewRateDto {
  @IsUUID()
  vocabId!: string;

  @IsBoolean()
  correct!: boolean;
}

export class ReviewRateResponseDto {
  updated!: { box: number; dueAt: Date };
  remaining!: number;
}
```

**review-complete.dto.ts**
```ts
export class ReviewCompleteResponseDto {
  total!: number;
  correct!: number;
  wrong!: number;
  accuracy!: number;
  boxDistribution!: Array<{ box: number; count: number }>;
}
```

### Controller: `src/modules/vocabulary/vocabulary-review.controller.ts`

```ts
@ApiTags('Vocabulary Review')
@ApiBearerAuth()
@Controller('vocabulary/review')
export class VocabularyReviewController {
  constructor(private readonly service: VocabularyReviewService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start a Leitner review session with due cards' })
  @ApiResponse({ status: 200, type: ReviewStartResponseDto })
  start(@Req() req: any, @Body() dto: ReviewStartDto) {
    return this.service.start(req.user.id, dto);
  }

  @Post(':sessionId/rate')
  @ApiOperation({ summary: 'Rate a card (correct/wrong); applies Leitner transition' })
  @ApiResponse({ status: 200, type: ReviewRateResponseDto })
  rate(@Req() req: any, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: ReviewRateDto) {
    return this.service.rate(req.user.id, sessionId, dto);
  }

  @Post(':sessionId/complete')
  @ApiOperation({ summary: 'Complete review session and return stats' })
  @ApiResponse({ status: 200, type: ReviewCompleteResponseDto })
  complete(@Req() req: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.service.complete(req.user.id, sessionId);
  }
}
```

### Module: `src/modules/vocabulary/vocabulary.module.ts`

```ts
@Module({
  imports: [TypeOrmModule.forFeature([Vocabulary])],
  controllers: [VocabularyController, VocabularyReviewController],
  providers: [VocabularyService, VocabularyReviewService, ReviewSessionStore],
  exports: [VocabularyService],
})
export class VocabularyModule {}
```

Register `VocabularyModule` in `src/app.module.ts` imports.

## Related Code Files

**Create**
- `src/modules/vocabulary/dto/review-start.dto.ts`
- `src/modules/vocabulary/dto/review-rate.dto.ts`
- `src/modules/vocabulary/dto/review-complete.dto.ts`
- `src/modules/vocabulary/vocabulary-review.controller.ts`

**Modify**
- `src/modules/vocabulary/vocabulary.module.ts` — full wiring (upgraded from stub)
- `src/app.module.ts` — add `VocabularyModule`

## Implementation Steps

1. Create 3 DTO files.
2. Create `VocabularyReviewController`.
3. Upgrade `VocabularyModule` to include both controllers + all services + `ReviewSessionStore`.
4. Verify `AppModule` imports `VocabularyModule`.
5. `npm run build` clean.
6. `npm run start:dev` — hit `/api/docs`, verify all 6 endpoints:
   - GET /vocabulary
   - GET /vocabulary/:id
   - DELETE /vocabulary/:id
   - POST /vocabulary/review/start
   - POST /vocabulary/review/:sessionId/rate
   - POST /vocabulary/review/:sessionId/complete
7. Manual smoke test:
```bash
# Start session
curl -X POST http://localhost:3000/vocabulary/review/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"limit": 5}'

# Rate a card
curl -X POST http://localhost:3000/vocabulary/review/$SESSION_ID/rate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"vocabId":"<uuid>","correct":true}'

# Complete
curl -X POST http://localhost:3000/vocabulary/review/$SESSION_ID/complete \
  -H "Authorization: Bearer $TOKEN"
```

## Todo List

- [ ] Create review DTOs (start / rate / complete)
- [ ] Create `VocabularyReviewController`
- [ ] Wire full `VocabularyModule` with all providers + both controllers
- [ ] Register `VocabularyModule` in `AppModule`
- [ ] `npm run build` passes
- [ ] Swagger shows all 6 endpoints
- [ ] Manual smoke test: start → rate → complete cycle works

## Success Criteria

- All 6 endpoints appear in Swagger with correct schemas
- Review session flow works end-to-end manually
- Leitner transition applied correctly (verify via `GET /vocabulary/:id` after rate)
- `completed` session returns accurate stats
- 401 without JWT, 404 for expired session, 403 for other user's session

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Circular imports (ReviewSessionStore used by service, injected via module) | Provider pattern is clean — no circular ref |
| DTO validation fails silently for numeric Query params | Use `@Type(() => Number)` + `enableImplicitConversion: true` in ValidationPipe global config (likely already set) |

## Security Considerations

- All endpoints protected by global JWT guard
- `ParseUUIDPipe` on `:sessionId` prevents malformed input
- Service double-checks ownership at session + vocab level

## Next Steps
- Phase 05: Tests
