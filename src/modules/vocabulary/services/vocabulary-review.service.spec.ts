import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { ReviewSessionStore } from './review-session-store';
import { VocabularyReviewService } from './vocabulary-review.service';

const mockVocab = (overrides: Partial<Vocabulary> = {}): Vocabulary =>
  ({
    id: 'v-1',
    userId: 'u-1',
    word: 'hello',
    translation: 'hola',
    sourceLang: 'en',
    targetLang: 'es',
    partOfSpeech: 'greeting',
    pronunciation: null as any,
    definition: null as any,
    examples: null as any,
    box: 1,
    dueAt: new Date('2026-04-12T00:00:00Z'),
    lastReviewedAt: null,
    reviewCount: 0,
    correctCount: 0,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    user: undefined as any,
    ...overrides,
  }) as Vocabulary;

const makeStartQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
});

const makeDistQb = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
});

describe('VocabularyReviewService', () => {
  let service: VocabularyReviewService;
  let repo: any;
  let store: ReviewSessionStore;

  beforeEach(async () => {
    store = new ReviewSessionStore();
    repo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabularyReviewService,
        { provide: getRepositoryToken(Vocabulary), useValue: repo },
        { provide: ReviewSessionStore, useValue: store },
      ],
    }).compile();
    service = module.get<VocabularyReviewService>(VocabularyReviewService);
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  describe('start', () => {
    it('returns due cards for user and creates session', async () => {
      const qb = makeStartQb();
      qb.getMany.mockResolvedValue([mockVocab({ id: 'v-1' }), mockVocab({ id: 'v-2' })]);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.start('u-1', {} as any);

      expect(qb.where).toHaveBeenCalledWith('v.userId = :userId', { userId: 'u-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('v.dueAt <= NOW()');
      expect(qb.limit).toHaveBeenCalledWith(20);
      expect(result.total).toBe(2);
      expect(result.cards).toHaveLength(2);
      expect(result.sessionId).toBeDefined();
    });

    it('applies languageCode filter', async () => {
      const qb = makeStartQb();
      qb.getMany.mockResolvedValue([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.start('u-1', { languageCode: 'es' } as any);
      expect(qb.andWhere).toHaveBeenCalledWith('v.targetLang = :lang', { lang: 'es' });
    });

    it('applies custom limit', async () => {
      const qb = makeStartQb();
      qb.getMany.mockResolvedValue([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.start('u-1', { limit: 5 } as any);
      expect(qb.limit).toHaveBeenCalledWith(5);
    });

    it('returns empty session when nothing due', async () => {
      const qb = makeStartQb();
      qb.getMany.mockResolvedValue([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.start('u-1', {} as any);
      expect(result.total).toBe(0);
      expect(result.cards).toEqual([]);
    });
  });

  describe('rate', () => {
    let sessionId: string;
    beforeEach(() => {
      sessionId = store.create('u-1', ['v-1', 'v-2']).id;
    });

    it('applies Leitner + persists vocab (correct)', async () => {
      const v = mockVocab({ box: 1, reviewCount: 0, correctCount: 0 });
      repo.findOne.mockResolvedValue(v);
      repo.save.mockImplementation((x: Vocabulary) => Promise.resolve(x));

      const result = await service.rate('u-1', sessionId, { vocabId: 'v-1', correct: true });

      expect(v.box).toBe(2);
      expect(v.reviewCount).toBe(1);
      expect(v.correctCount).toBe(1);
      expect(v.lastReviewedAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledWith(v);
      expect(result.updated.box).toBe(2);
      expect(result.remaining).toBe(1);
    });

    it('increments reviewCount only on wrong', async () => {
      const v = mockVocab({ box: 3, reviewCount: 5, correctCount: 3 });
      repo.findOne.mockResolvedValue(v);
      repo.save.mockImplementation((x: Vocabulary) => Promise.resolve(x));

      await service.rate('u-1', sessionId, { vocabId: 'v-1', correct: false });

      expect(v.box).toBe(1);
      expect(v.reviewCount).toBe(6);
      expect(v.correctCount).toBe(3);
    });

    it('throws BadRequestException when card not in session', async () => {
      await expect(
        service.rate('u-1', sessionId, { vocabId: 'v-other', correct: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already rated', async () => {
      repo.findOne.mockResolvedValue(mockVocab());
      repo.save.mockImplementation((x: Vocabulary) => Promise.resolve(x));
      await service.rate('u-1', sessionId, { vocabId: 'v-1', correct: true });

      await expect(
        service.rate('u-1', sessionId, { vocabId: 'v-1', correct: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when vocab missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.rate('u-1', sessionId, { vocabId: 'v-1', correct: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('decrements `remaining` as ratings accumulate', async () => {
      repo.findOne.mockResolvedValue(mockVocab({ id: 'v-1' }));
      repo.save.mockImplementation((x: Vocabulary) => Promise.resolve(x));
      const r1 = await service.rate('u-1', sessionId, { vocabId: 'v-1', correct: true });
      expect(r1.remaining).toBe(1);

      repo.findOne.mockResolvedValue(mockVocab({ id: 'v-2' }));
      const r2 = await service.rate('u-1', sessionId, { vocabId: 'v-2', correct: false });
      expect(r2.remaining).toBe(0);
    });
  });

  describe('complete', () => {
    let sessionId: string;
    beforeEach(() => {
      sessionId = store.create('u-1', ['v-1', 'v-2', 'v-3']).id;
    });

    const stubBoxDist = (rows: Array<{ box: number; count: number }>) => {
      const qb = makeDistQb();
      qb.getRawMany.mockResolvedValue(rows);
      repo.createQueryBuilder.mockReturnValue(qb);
    };

    it('returns accurate stats', async () => {
      const session = store.get(sessionId, 'u-1');
      session.ratings.set('v-1', true);
      session.ratings.set('v-2', true);
      session.ratings.set('v-3', false);
      stubBoxDist([{ box: 1, count: 1 }, { box: 2, count: 2 }]);

      const result = await service.complete('u-1', sessionId);

      expect(result.total).toBe(3);
      expect(result.correct).toBe(2);
      expect(result.wrong).toBe(1);
      expect(result.accuracy).toBe(67);
      expect(result.boxDistribution).toEqual([
        { box: 1, count: 1 },
        { box: 2, count: 2 },
      ]);
    });

    it('coerces raw string counts to numbers', async () => {
      stubBoxDist([{ box: '1' as any, count: '7' as any }]);

      const result = await service.complete('u-1', sessionId);
      expect(result.boxDistribution[0]).toEqual({ box: 1, count: 7 });
    });

    it('deletes session after complete', async () => {
      stubBoxDist([]);
      await service.complete('u-1', sessionId);
      expect(() => store.get(sessionId, 'u-1')).toThrow();
    });

    it('handles empty session (0 ratings) — accuracy = 0', async () => {
      stubBoxDist([]);
      const result = await service.complete('u-1', sessionId);
      expect(result).toEqual({
        total: 0,
        correct: 0,
        wrong: 0,
        accuracy: 0,
        boxDistribution: [],
      });
    });
  });
});
