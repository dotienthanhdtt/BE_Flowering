# Phase 03: Leitner Logic + Review Session Store

## Context Links
- Brainstorm: `plans/reports/brainstorm-260412-2302-vocabulary-srs-leitner.md`
- Reference session pattern: `src/modules/onboarding/onboarding.service.ts`

## Overview
- Priority: P1
- Status: pending
- Effort: M (2h)

Implement Leitner box transitions + in-memory review session store + `VocabularyReviewService`.

## Key Insights

- Leitner logic is pure-functional: `(currentBox, correct) => { newBox, nextDueAt }`. Extract to helper for testability.
- Session store is in-memory `Map` with periodic TTL sweep (1h). Singleton provider.
- Session owns which cards user started reviewing — rate endpoints validate vocabId is in session's card list.
- "Re-rate same card in session" → reject with BadRequestException.
- Session complete → return stats + delete session from Map.

## Requirements

**Functional**
- `startReview(userId, dto)` → creates session, returns due cards (by `languageCode` if provided, `dueAt <= NOW`, limit).
- `rateCard(userId, sessionId, dto)` → validates ownership + card-in-session + not-yet-rated → applies Leitner → persists vocabulary.
- `completeReview(userId, sessionId)` → aggregates stats from session ratings + box distribution from DB → returns + deletes session.
- TTL sweep: sessions older than 1h purged.

**Non-functional**
- Pure Leitner function 100% branch coverage.
- Session store thread-safe enough for single-pod (JS event loop is single-threaded; no locks needed).

## Architecture

### Pure Leitner helper: `src/modules/vocabulary/services/leitner.ts`

```ts
export const LEITNER_INTERVALS_DAYS: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

export interface LeitnerTransition {
  box: number;
  dueAt: Date;
}

export function applyLeitner(currentBox: number, correct: boolean, now: Date = new Date()): LeitnerTransition {
  const newBox = correct ? Math.min(currentBox + 1, 5) : 1;
  const intervalDays = correct ? LEITNER_INTERVALS_DAYS[newBox] : 1;
  const dueAt = new Date(now.getTime() + intervalDays * 86_400_000);
  return { box: newBox, dueAt };
}
```

### Session store: `src/modules/vocabulary/services/review-session-store.ts`

```ts
export interface ReviewSession {
  id: string;
  userId: string;
  cardIds: string[];
  ratings: Map<string, boolean>; // vocabId → correct
  startedAt: Date;
}

@Injectable()
export class ReviewSessionStore implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly TTL_MS = 60 * 60 * 1000; // 1h
  private sweepTimer?: NodeJS.Timeout;

  onModuleInit() {
    this.sweepTimer = setInterval(() => this.sweep(), 5 * 60 * 1000); // every 5m
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  create(userId: string, cardIds: string[]): ReviewSession {
    const session: ReviewSession = {
      id: randomUUID(), userId, cardIds, ratings: new Map(), startedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string, userId: string): ReviewSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException('Session not found or expired');
    if (s.userId !== userId) throw new ForbiddenException();
    if (Date.now() - s.startedAt.getTime() > this.TTL_MS) {
      this.sessions.delete(sessionId);
      throw new NotFoundException('Session expired');
    }
    return s;
  }

  delete(sessionId: string) { this.sessions.delete(sessionId); }

  private sweep() {
    const cutoff = Date.now() - this.TTL_MS;
    for (const [id, s] of this.sessions) {
      if (s.startedAt.getTime() < cutoff) this.sessions.delete(id);
    }
  }
}
```

### Review service: `src/modules/vocabulary/services/vocabulary-review.service.ts`

```ts
@Injectable()
export class VocabularyReviewService {
  constructor(
    @InjectRepository(Vocabulary) private readonly repo: Repository<Vocabulary>,
    private readonly store: ReviewSessionStore,
  ) {}

  async start(userId: string, dto: ReviewStartDto): Promise<ReviewStartResponseDto> {
    const qb = this.repo.createQueryBuilder('v')
      .where('v.userId = :userId AND v.dueAt <= NOW()', { userId });
    if (dto.languageCode) qb.andWhere('v.targetLang = :lang', { lang: dto.languageCode });
    qb.orderBy('v.dueAt', 'ASC').limit(dto.limit ?? 20);

    const cards = await qb.getMany();
    const session = this.store.create(userId, cards.map(c => c.id));
    return {
      sessionId: session.id,
      cards: cards.map(this.toCardDto),
      total: cards.length,
    };
  }

  async rate(userId: string, sessionId: string, dto: ReviewRateDto): Promise<ReviewRateResponseDto> {
    const session = this.store.get(sessionId, userId);
    if (!session.cardIds.includes(dto.vocabId)) throw new BadRequestException('Card not in session');
    if (session.ratings.has(dto.vocabId)) throw new BadRequestException('Card already rated');

    const vocab = await this.repo.findOne({ where: { id: dto.vocabId, userId } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');

    const { box, dueAt } = applyLeitner(vocab.box, dto.correct);
    vocab.box = box;
    vocab.dueAt = dueAt;
    vocab.lastReviewedAt = new Date();
    vocab.reviewCount += 1;
    if (dto.correct) vocab.correctCount += 1;
    await this.repo.save(vocab);

    session.ratings.set(dto.vocabId, dto.correct);
    return {
      updated: { box, dueAt },
      remaining: session.cardIds.length - session.ratings.size,
    };
  }

  async complete(userId: string, sessionId: string): Promise<ReviewCompleteResponseDto> {
    const session = this.store.get(sessionId, userId);
    const total = session.ratings.size;
    const correct = [...session.ratings.values()].filter(v => v).length;
    const wrong = total - correct;
    const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100);

    const boxDist = await this.repo
      .createQueryBuilder('v')
      .select('v.box', 'box').addSelect('COUNT(*)', 'count')
      .where('v.userId = :userId', { userId })
      .groupBy('v.box').getRawMany();

    this.store.delete(sessionId);
    return { total, correct, wrong, accuracy, boxDistribution: boxDist };
  }

  private toCardDto = (v: Vocabulary): ReviewCardDto => ({ /* field map */ });
}
```

## Related Code Files

**Create**
- `src/modules/vocabulary/services/leitner.ts`
- `src/modules/vocabulary/services/review-session-store.ts`
- `src/modules/vocabulary/services/vocabulary-review.service.ts`

## Implementation Steps

1. Create `leitner.ts` with `applyLeitner` pure function + intervals constant.
2. Create `ReviewSessionStore` as `@Injectable()` with Map + TTL sweep via `setInterval`.
3. Create `VocabularyReviewService` with `start`/`rate`/`complete`.
4. `npm run build` clean (DTOs added in Phase 04 — stub them or defer build check).

## Todo List

- [ ] Create `leitner.ts` pure helper
- [ ] Create `ReviewSessionStore` with TTL sweep + OnModuleDestroy cleanup
- [ ] Create `VocabularyReviewService` with start/rate/complete
- [ ] Verify build (may defer until Phase 04 wires DTOs)

## Success Criteria

- `applyLeitner(1, true)` → `{ box: 2, dueAt: +3d }`
- `applyLeitner(5, true)` → `{ box: 5, dueAt: +30d }` (capped)
- `applyLeitner(3, false)` → `{ box: 1, dueAt: +1d }`
- Session store evicts expired sessions after 1h
- Same-card-twice rating rejected with BadRequestException
- Non-owner session access rejected with ForbiddenException

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Timer memory leak | `OnModuleDestroy` clears interval |
| Session grows unbounded | 1h TTL + 5m sweep cap memory usage |
| Concurrent rate requests on same card | Single-threaded event loop + `ratings.has` check before DB write — safe enough for MVP |
| `findOne` race vs `save` | Low risk; user-driven sequential UX |

## Security Considerations

- Ownership checked at session level (`userId` match) AND at vocab level (`where: { id, userId }`)
- Session IDs are UUID v4 — not guessable
- In-memory store isolates by process — no cross-tenant leak

## Next Steps
- Phase 04: Wire up review controller + DTOs + module
