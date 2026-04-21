import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VocabularyInjectionService } from './vocabulary-injection.service';
import { Vocabulary } from '@/database/entities/vocabulary.entity';

const makeVocab = (id: string): Vocabulary => ({ id } as Vocabulary);

const makeQbChain = (result: Vocabulary[]) => {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
  };
  return qb;
};

describe('VocabularyInjectionService', () => {
  let service: VocabularyInjectionService;
  let createQueryBuilder: jest.Mock;

  beforeEach(async () => {
    createQueryBuilder = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabularyInjectionService,
        {
          provide: getRepositoryToken(Vocabulary),
          useValue: { createQueryBuilder },
        },
      ],
    }).compile();

    service = module.get<VocabularyInjectionService>(VocabularyInjectionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('1. empty buckets → returns []', async () => {
    createQueryBuilder
      .mockReturnValueOnce(makeQbChain([]))
      .mockReturnValueOnce(makeQbChain([]));

    const result = await service.selectVocabularyForConversation('u1', 'ja');
    expect(result).toEqual([]);
  });

  it('2. A=3, B=0 → returns 3 items', async () => {
    const a = [makeVocab('a1'), makeVocab('a2'), makeVocab('a3')];
    createQueryBuilder
      .mockReturnValueOnce(makeQbChain(a))
      .mockReturnValueOnce(makeQbChain([]));

    const result = await service.selectVocabularyForConversation('u1', 'ja');
    expect(result).toHaveLength(3);
    expect(result.map((v) => v.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('3. A=5, B=5, no overlap → returns 10 in A-then-B order', async () => {
    const a = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeVocab);
    const b = ['b1', 'b2', 'b3', 'b4', 'b5'].map(makeVocab);
    createQueryBuilder
      .mockReturnValueOnce(makeQbChain(a))
      .mockReturnValueOnce(makeQbChain(b));

    const result = await service.selectVocabularyForConversation('u1', 'ja');
    expect(result).toHaveLength(10);
    expect(result.map((v) => v.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5']);
  });

  it('4. A=5, B=5, 2 overlap → returns 8 unique items', async () => {
    const a = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeVocab);
    // b1 and b2 overlap with a1/a2
    const b = ['a1', 'a2', 'b3', 'b4', 'b5'].map(makeVocab);
    createQueryBuilder
      .mockReturnValueOnce(makeQbChain(a))
      .mockReturnValueOnce(makeQbChain(b));

    const result = await service.selectVocabularyForConversation('u1', 'ja');
    expect(result).toHaveLength(8);
    const ids = result.map((v) => v.id);
    // no duplicates
    expect(new Set(ids).size).toBe(8);
  });

  it('5. A=5, B=8, no overlap → truncated to 10', async () => {
    const a = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeVocab);
    const b = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'].map(makeVocab);
    createQueryBuilder
      .mockReturnValueOnce(makeQbChain(a))
      .mockReturnValueOnce(makeQbChain(b));

    const result = await service.selectVocabularyForConversation('u1', 'ja');
    expect(result).toHaveLength(10);
  });

  it('6. hydrateByIds([]) → no DB call, returns []', async () => {
    const result = await service.hydrateByIds([]);
    expect(result).toEqual([]);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('7. hydrateByIds preserves input order even when DB returns reversed', async () => {
    const x = makeVocab('x');
    const y = makeVocab('y');
    // DB returns y before x
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([y, x]),
    };
    createQueryBuilder.mockReturnValueOnce(qb);

    const result = await service.hydrateByIds(['x', 'y']);
    expect(result.map((v) => v.id)).toEqual(['x', 'y']);
  });
});
