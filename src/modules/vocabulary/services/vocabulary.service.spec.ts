import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { VocabularyService } from './vocabulary.service';

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

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
});

describe('VocabularyService', () => {
  let service: VocabularyService;
  let repo: any;
  let qb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    qb = makeQb();
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabularyService,
        { provide: getRepositoryToken(Vocabulary), useValue: repo },
      ],
    }).compile();
    service = module.get<VocabularyService>(VocabularyService);
  });

  describe('list', () => {
    it('filters by userId and paginates', async () => {
      qb.getManyAndCount.mockResolvedValue([[mockVocab()], 1]);

      const result = await service.list('u-1', { page: 1, limit: 20 } as any);

      expect(qb.where).toHaveBeenCalledWith('v.userId = :userId', { userId: 'u-1' });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].box).toBe(1);
    });

    it('applies languageCode / box / search filters', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.list('u-1', {
        languageCode: 'es',
        box: 2,
        search: 'hola',
        page: 1,
        limit: 10,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('v.targetLang = :lang', { lang: 'es' });
      expect(qb.andWhere).toHaveBeenCalledWith('v.box = :box', { box: 2 });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(v.word ILIKE :s OR v.translation ILIKE :s)',
        { s: '%hola%' },
      );
    });

    it('computes pagination offset for page > 1', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.list('u-1', { page: 3, limit: 15 } as any);
      expect(qb.skip).toHaveBeenCalledWith(30);
      expect(qb.take).toHaveBeenCalledWith(15);
    });

    it('returns empty list when no results', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      const result = await service.list('u-1', { page: 1, limit: 20 } as any);
      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('findOne', () => {
    it('returns item for owner', async () => {
      repo.findOne.mockResolvedValue(mockVocab());
      const r = await service.findOne('u-1', 'v-1');
      expect(r.id).toBe('v-1');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'v-1', userId: 'u-1' } });
    });

    it('throws NotFoundException when not found or not owned', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('u-1', 'v-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes for owner', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.remove('u-1', 'v-1')).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith({ id: 'v-1', userId: 'u-1' });
    });

    it('throws NotFoundException when affected=0', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove('u-1', 'v-x')).rejects.toThrow(NotFoundException);
    });
  });
});
