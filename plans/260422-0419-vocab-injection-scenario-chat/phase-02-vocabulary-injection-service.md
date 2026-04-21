# Phase 02 — Vocabulary Injection Service

## Context Links

- Brainstorm: `plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md` (§4.1, §4.4)
- Phase 01 output (entity + indexes)
- Style reference: `src/modules/vocabulary/services/vocabulary-review.service.ts` (QueryBuilder patterns)
- Config pattern: none project-wide — create fresh under scenario module

## Overview

- **Priority:** P1 (blocks Phase 03)
- **Status:** done
- **Brief:** New injectable service that returns up to N deduped vocab rows via two-bucket query (recency rotation + SRS-due). Tunable via config file.

## Key Insights

- Two independent queries then dedup-in-code is simpler and cheaper than `UNION ALL` + client-side merge; TypeORM QueryBuilder `.getMany()` returns hydrated entities on both calls (KISS wins over micro-optimization).
- Bucket A uses `box < 5` (exclude mastered). Bucket B uses `box <= 4` — effectively identical, but keep both config constants since brainstorm locked them separately.
- `NULLS FIRST` on `last_reviewed_at` is critical: words never reviewed must bubble up (translate-only users). PG default for ASC is NULLS LAST → explicit override required.
- Service returns **entities** (full `Vocabulary` rows); hydration for prompt formatting is caller's concern (KISS / separation).
- `hydrate(ids)` method needed for turn 2+ (Phase 03).

## Requirements

### Functional
- `selectVocabularyForConversation(userId, targetLang)` returns `Vocabulary[]` length 0..`totalWords`.
- Query A: `box < maxBoxForRotation + 1` (i.e. `< 5`), filter by user + lang, order `last_reviewed_at ASC NULLS FIRST`, limit `recentBucketSize`.
- Query B: `due_at <= NOW()` AND `box <= maxBoxForSrs`, filter by user + lang, order `correct_count ASC, due_at ASC`, limit `srsBucketSize`.
- Merge: dedup by `id`, preserve insertion order (A first, then B).
- `hydrateByIds(ids: string[])` returns `Vocabulary[]`, preserving order matching `ids` array. Empty `ids` → empty array (no DB call).
- On query error → caller's responsibility; service MUST NOT swallow.

### Non-Functional
- Both queries must use new composite indexes from Phase 01 (verified via EXPLAIN in Phase 05 tests).
- Service file < 100 lines.
- Config file < 30 lines, exports frozen constant.

## Architecture

### Data Flow

```
selectVocabularyForConversation(userId, targetLang):
  ├─► Query A (rotation):      Vocabulary WHERE userId=? AND targetLang=? AND box<5 ORDER BY last_reviewed_at ASC NULLS FIRST LIMIT 5
  ├─► Query B (SRS due):       Vocabulary WHERE userId=? AND targetLang=? AND dueAt<=NOW() AND box<=4 ORDER BY correct_count ASC, due_at ASC LIMIT 5
  ├─► Merge: [...A, ...B.filter(b => !A.has(b.id))]
  └─► Return Vocabulary[] (len ≤ totalWords)

hydrateByIds(ids):
  ├─► if ids.length === 0 → return []
  ├─► Vocabulary WHERE id = ANY(ids)
  └─► Return array ordered to match ids input (map-by-id, preserve order)
```

## Related Code Files

### Create
- `src/modules/scenario/services/vocabulary-injection.service.ts`
- `src/modules/scenario/services/vocabulary-injection.service.spec.ts`
- `src/modules/scenario/config/vocab-injection.config.ts`

### Modify
- (none this phase — wiring happens in Phase 03)

### Delete
- none

## Implementation Steps

1. **Create config** `src/modules/scenario/config/vocab-injection.config.ts`:
   ```ts
   export const VOCAB_INJECTION_CONFIG = Object.freeze({
     totalWords: 10,
     recentBucketSize: 5,
     srsBucketSize: 5,
     maxBoxForSrs: 4,       // Bucket B: box <= 4
     maxBoxForRotation: 4,  // Bucket A: box < 5 (same result, kept for clarity)
   });
   export type VocabInjectionConfig = typeof VOCAB_INJECTION_CONFIG;
   ```

2. **Create service** `src/modules/scenario/services/vocabulary-injection.service.ts`:
   - `@Injectable()` class `VocabularyInjectionService`.
   - Constructor: `@InjectRepository(Vocabulary) private readonly repo: Repository<Vocabulary>`.
   - Private helpers `queryRotationBucket(userId, lang)` and `querySrsBucket(userId, lang)` each returning `Promise<Vocabulary[]>`.
   - Public method `selectVocabularyForConversation(userId, targetLang)`:
     ```ts
     const [recent, due] = await Promise.all([
       this.queryRotationBucket(userId, targetLang),
       this.querySrsBucket(userId, targetLang),
     ]);
     const seen = new Set(recent.map(v => v.id));
     const merged = [...recent];
     for (const v of due) if (!seen.has(v.id)) { merged.push(v); seen.add(v.id); }
     return merged.slice(0, VOCAB_INJECTION_CONFIG.totalWords);
     ```
   - Public method `hydrateByIds(ids: string[])`:
     ```ts
     if (!ids?.length) return [];
     const rows = await this.repo.createQueryBuilder('v')
       .where('v.id = ANY(:ids)', { ids }).getMany();
     const byId = new Map(rows.map(r => [r.id, r]));
     return ids.map(id => byId.get(id)).filter((v): v is Vocabulary => !!v);
     ```
   - QueryBuilder specifics:
     ```ts
     // rotation
     this.repo.createQueryBuilder('v')
       .where('v.userId = :userId', { userId })
       .andWhere('v.targetLang = :lang', { lang })
       .andWhere('v.box < 5')
       .orderBy('v.lastReviewedAt', 'ASC', 'NULLS FIRST')
       .limit(VOCAB_INJECTION_CONFIG.recentBucketSize)
       .getMany();
     // srs
     this.repo.createQueryBuilder('v')
       .where('v.userId = :userId', { userId })
       .andWhere('v.targetLang = :lang', { lang })
       .andWhere('v.dueAt <= NOW()')
       .andWhere('v.box <= :maxBox', { maxBox: VOCAB_INJECTION_CONFIG.maxBoxForSrs })
       .orderBy('v.correctCount', 'ASC')
       .addOrderBy('v.dueAt', 'ASC')
       .limit(VOCAB_INJECTION_CONFIG.srsBucketSize)
       .getMany();
     ```

3. **Create unit test** `vocabulary-injection.service.spec.ts`:
   - Mock `Vocabulary` repo with `createQueryBuilder` chain returning controlled arrays.
   - Cases:
     - Empty buckets → returns `[]`.
     - A=3 items, B=0 → returns 3.
     - A=5, B=5, no overlap → returns 10 in A-then-B order.
     - A=5, B=5, 2 overlap by id → returns 8.
     - A=5, B=8, no overlap → truncated to 10 (5 from A + 5 from B).
     - `hydrateByIds([])` → no DB call, returns `[]`.
     - `hydrateByIds(['x','y'])` → preserves input order even when DB returns reversed.

4. **Do NOT wire into module yet** — Phase 03 owns `scenario-chat.module.ts` edits. This keeps phase file ownership clean.

5. **Build check**: `npm run build` passes (service compiles standalone; its module registration is Phase 03).

## Todo List

- [ ] Create `vocab-injection.config.ts`
- [ ] Create `vocabulary-injection.service.ts` with `selectVocabularyForConversation` + `hydrateByIds`
- [ ] Write unit spec covering 7 cases above
- [ ] `npm test -- vocabulary-injection.service.spec` passes
- [ ] `npm run build` passes

## Success Criteria

- Spec suite: 7/7 green.
- Both public methods exported, typed `Promise<Vocabulary[]>`.
- No direct SQL strings — all via QueryBuilder.
- File < 100 lines.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `NULLS FIRST` syntax incompatible with TypeORM chain | Low | Med | `.orderBy(field, 'ASC', 'NULLS FIRST')` is supported by TypeORM; fallback to `.addSelect` expression if needed |
| `ANY(:ids)` param binding misinterpreted | Low | Med | TypeORM handles `string[]` param → PG `uuid[]` natively; test covers this path |
| Dedup order bug — A's version kept vs B's | Low | Low | Test case confirms A-first order |
| Large vocab user (>10K) slows bucket A | Low | Med | Phase-01 composite index covers order-by; LIMIT 5 makes cost O(log n + 5) |

## Security Considerations

- User-scoped queries only (`userId = :userId`) — no cross-tenant leak possible.
- `targetLang` is a trusted string pulled from `UserLanguage.language.code` upstream (Phase 03 responsibility to source correctly).
- No raw SQL; all params via QueryBuilder bindings → SQL injection safe.

## Next Steps

- Phase 03 wires service into `ScenarioChatService` and `ScenarioChatModule`.
- Phase 04 reuses `hydrateByIds` during usage-tracking read path.
