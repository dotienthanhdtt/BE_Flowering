# Phase 02: Vocabulary CRUD Service + Controller

## Context Links
- Brainstorm: `plans/reports/brainstorm-260412-2302-vocabulary-srs-leitner.md`
- Reference controller: `src/modules/ai/ai.controller.ts`
- Reference pagination pattern: `src/modules/lesson/lesson.service.ts` (getLessons paginated list)

## Overview
- Priority: P1
- Status: pending
- Effort: M (1.5h)

Build read-only vocabulary endpoints — list with filters, get-by-id, delete. No create/update (auto-save handles create).

## Key Insights

- User only sees their own vocabulary — enforce `userId` filter in every query.
- Filter by `languageCode` requires join to `Language` table OR filter by `targetLang` varchar code directly (current `vocabulary.target_lang` is a 10-char code). Code is simpler, no join. Choose code.
- Return SRS fields (`box`, `dueAt`, `reviewCount`, `correctCount`) in responses — useful for client to show progress.

## Requirements

**Functional**
- `GET /vocabulary` — paginated list. Query: `languageCode?, box?, search?, page=1, limit=20`. Max limit 100.
- `GET /vocabulary/:id` — single card. 404 if not found or not owned.
- `DELETE /vocabulary/:id` — idempotent delete. 204 on success.
- All endpoints JWT-protected, scoped to `req.user.id`.

**Non-functional**
- Service < 150 lines.
- Pagination uses offset+limit (simple; switch to cursor later if needed).
- All queries parameterized via TypeORM repo.

## Architecture

### DTOs: `src/modules/vocabulary/dto/`

**vocabulary-query.dto.ts**
```ts
export class VocabularyQueryDto {
  @IsOptional() @IsString() @Length(2, 10)
  languageCode?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  box?: number;

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;
}
```

**vocabulary-response.dto.ts**
```ts
export class VocabularyItemDto {
  id!: string;
  word!: string;
  translation!: string;
  sourceLang!: string;
  targetLang!: string;
  partOfSpeech?: string;
  pronunciation?: string;
  definition?: string;
  examples?: string[];
  box!: number;
  dueAt!: Date;
  lastReviewedAt?: Date | null;
  reviewCount!: number;
  correctCount!: number;
  createdAt!: Date;
}

export class VocabularyListDto {
  items!: VocabularyItemDto[];
  total!: number;
  page!: number;
  limit!: number;
}
```

### Service: `src/modules/vocabulary/services/vocabulary.service.ts`

```ts
@Injectable()
export class VocabularyService {
  constructor(@InjectRepository(Vocabulary) private readonly repo: Repository<Vocabulary>) {}

  async list(userId: string, q: VocabularyQueryDto): Promise<VocabularyListDto> {
    const qb = this.repo.createQueryBuilder('v').where('v.userId = :userId', { userId });
    if (q.languageCode) qb.andWhere('v.targetLang = :lang', { lang: q.languageCode });
    if (q.box !== undefined) qb.andWhere('v.box = :box', { box: q.box });
    if (q.search) qb.andWhere('(v.word ILIKE :s OR v.translation ILIKE :s)', { s: `%${q.search}%` });
    qb.orderBy('v.createdAt', 'DESC').skip((q.page - 1) * q.limit).take(q.limit);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map(this.toDto), total, page: q.page, limit: q.limit };
  }

  async findOne(userId: string, id: string): Promise<VocabularyItemDto> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Vocabulary not found');
    return this.toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, userId });
    if (res.affected === 0) throw new NotFoundException('Vocabulary not found');
  }

  private toDto = (v: Vocabulary): VocabularyItemDto => ({ /* field-by-field map */ });
}
```

### Controller: `src/modules/vocabulary/vocabulary.controller.ts`

```ts
@ApiTags('Vocabulary')
@ApiBearerAuth()
@Controller('vocabulary')
export class VocabularyController {
  constructor(private readonly service: VocabularyService) {}

  @Get()
  @ApiOperation({ summary: 'List my vocabulary with filters' })
  list(@Req() req: any, @Query() q: VocabularyQueryDto) {
    return this.service.list(req.user.id, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a vocabulary item' })
  findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a vocabulary item' })
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(req.user.id, id);
  }
}
```

## Related Code Files

**Create**
- `src/modules/vocabulary/vocabulary.module.ts` (stub — Phase 04 wires review pieces)
- `src/modules/vocabulary/vocabulary.controller.ts`
- `src/modules/vocabulary/services/vocabulary.service.ts`
- `src/modules/vocabulary/dto/vocabulary-query.dto.ts`
- `src/modules/vocabulary/dto/vocabulary-response.dto.ts`

**Read for reference**
- `src/modules/lesson/lesson.service.ts` (pagination pattern)
- `src/database/entities/vocabulary.entity.ts`

## Implementation Steps

1. Create DTOs with class-validator decorators.
2. Create `VocabularyService` with `list/findOne/remove`.
3. Create `VocabularyController` mapping to service.
4. Stub `VocabularyModule` with TypeOrmModule.forFeature([Vocabulary]) + providers + controller (review pieces added in Phase 04).
5. Add `VocabularyModule` to `AppModule` imports.
6. `npm run build` clean.
7. Smoke test:
```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/vocabulary?limit=5"
```

## Todo List

- [ ] Create `VocabularyQueryDto` + response DTOs
- [ ] Create `VocabularyService` with list/findOne/remove
- [ ] Create `VocabularyController` with GET/GET:id/DELETE
- [ ] Create stub `VocabularyModule`
- [ ] Register in `AppModule`
- [ ] `npm run build` passes
- [ ] Manual smoke test returns 200

## Success Criteria

- `GET /vocabulary` returns paginated list scoped to user
- `GET /vocabulary/:id` returns 404 for other user's items
- `DELETE /vocabulary/:id` returns 204 on success, 404 otherwise
- `?languageCode=en&box=1&search=hello` filters apply correctly
- Swagger shows all 3 endpoints at `/api/docs`

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `ILIKE` slow without trigram index | Acceptable for MVP; add pg_trgm index if perf issues. |
| Missing `@Type(() => Number)` on Query DTO | Explicit `@Type` decorator on number fields for transform. |
| User IDs leak via 404 vs 403 discrimination | Use 404 for both "not found" and "not owned" — don't reveal existence. |

## Security Considerations

- Every query filters by `userId` — no cross-user access possible
- `ParseUUIDPipe` prevents malformed IDs reaching DB
- Return 404 (not 403) when item exists but belongs to other user — avoids enumeration

## Next Steps
- Phase 03: Leitner + review session logic
