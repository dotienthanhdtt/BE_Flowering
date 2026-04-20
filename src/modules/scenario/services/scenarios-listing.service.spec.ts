import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ScenariosListingService } from './scenarios-listing.service';
import { Scenario, ScenarioDifficulty } from '@/database/entities/scenario.entity';
import { UserAiScenario } from '@/database/entities/user-ai-scenario.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';

describe('ScenariosListingService', () => {
  let service: ScenariosListingService;
  let scenarioRepo: jest.Mocked<Repository<Scenario>>;
  let userAiScenarioRepo: jest.Mocked<Repository<UserAiScenario>>;

  const mockScenario = (id: string, overrides?: Partial<Scenario>): Scenario => ({
    id,
    type: ScenarioType.DEFAULT,
    title: `Scenario ${id}`,
    description: `Description for ${id}`,
    imageUrl: 'https://example.com/image.jpg',
    difficulty: ScenarioDifficulty.BEGINNER,
    languageId: 'lang-1',
    orderIndex: 0,
    categoryId: 'cat-1',
    status: ContentStatus.PUBLISHED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Scenario);

  const mockUserAiScenario = (id: string, title: string, createdAt: Date) => ({
    id,
    title,
    description: `AI Description for ${title}`,
    difficulty: ScenarioDifficulty.INTERMEDIATE,
    languageId: 'lang-1',
    userId: 'user-1',
    createdAt,
  });

  const mockQueryBuilder = (entities: Scenario[] = [], raw: any[] = []) => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
  } as unknown as SelectQueryBuilder<Scenario>);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosListingService,
        {
          provide: getRepositoryToken(Scenario),
          useValue: {
            findAndCount: jest.fn(),
            createQueryBuilder: jest.fn(),
          } as unknown as Repository<Scenario>,
        },
        {
          provide: getRepositoryToken(UserAiScenario),
          useValue: {
            find: jest.fn(),
          } as unknown as Repository<UserAiScenario>,
        },
      ],
    }).compile();

    service = module.get(ScenariosListingService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    userAiScenarioRepo = module.get(getRepositoryToken(UserAiScenario));
  });

  describe('listDefault', () => {
    it('returns paginated items with correct shape', async () => {
      const scenarios = [
        mockScenario('s1', { orderIndex: 1 }),
        mockScenario('s2', { orderIndex: 2 }),
      ];
      jest.spyOn(scenarioRepo, 'findAndCount').mockResolvedValue([scenarios, 2]);

      const result = await service.listDefault('lang-1', 1, 10);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 's1',
        title: 'Scenario s1',
        description: 'Description for s1',
        imageUrl: 'https://example.com/image.jpg',
        difficulty: ScenarioDifficulty.BEGINNER,
        languageId: 'lang-1',
        orderIndex: 1,
      });
    });

    it('passes correct where clause (type=DEFAULT, status=PUBLISHED)', async () => {
      jest.spyOn(scenarioRepo, 'findAndCount').mockResolvedValue([[], 0]);

      await service.listDefault('lang-1', 1, 10);

      expect(scenarioRepo.findAndCount).toHaveBeenCalledWith({
        where: {
          type: ScenarioType.DEFAULT,
          status: ContentStatus.PUBLISHED,
          languageId: 'lang-1',
        },
        order: { orderIndex: 'ASC', createdAt: 'DESC' },
        skip: 0,
        take: 10,
      });
    });

    it('applies pagination correctly', async () => {
      jest.spyOn(scenarioRepo, 'findAndCount').mockResolvedValue([[], 100]);

      await service.listDefault('lang-1', 2, 20);

      expect(scenarioRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
    });
  });

  describe('listPersonal', () => {
    it('merges AI and KOL scenarios sorted by addedAt DESC', async () => {
      jest.spyOn(userAiScenarioRepo, 'find').mockResolvedValue([
        mockUserAiScenario('ai-1', 'AI 1', new Date('2026-04-15')) as unknown as UserAiScenario,
        mockUserAiScenario('ai-2', 'AI 2', new Date('2026-04-20')) as unknown as UserAiScenario,
      ]);
      jest
        .spyOn(scenarioRepo, 'createQueryBuilder')
        .mockReturnValue(
          mockQueryBuilder(
            [mockScenario('kol-1', { type: ScenarioType.KOL })],
            [{ s_id: 'kol-1', grantedAt: '2026-04-18' }],
          ),
        );

      const result = await service.listPersonal('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(3);
      expect(result.items[0].id).toBe('ai-2');
      expect(result.items[0].source).toBe('personalized');
      expect(result.items[1].source).toBe('kol');
      expect(result.items[2].id).toBe('ai-1');
    });

    it('handles empty AI scenarios', async () => {
      jest.spyOn(userAiScenarioRepo, 'find').mockResolvedValue([] as unknown as UserAiScenario[]);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder([mockScenario('kol-1')], [{ s_id: 'kol-1' }]));

      const result = await service.listPersonal('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.items[0].source).toBe('kol');
    });

    it('handles empty KOL access', async () => {
      jest.spyOn(userAiScenarioRepo, 'find').mockResolvedValue([
        mockUserAiScenario('ai-1', 'AI', new Date()) as unknown as UserAiScenario,
      ]);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder());

      const result = await service.listPersonal('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.items[0].source).toBe('personalized');
    });

    it('applies pagination to merged results', async () => {
      jest
        .spyOn(userAiScenarioRepo, 'find')
        .mockResolvedValue(
          Array.from({ length: 5 }, (_, i) => mockUserAiScenario(`ai-${i}`, `AI ${i}`, new Date())) as unknown as UserAiScenario[],
        );
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder());

      const result = await service.listPersonal('user-1', 'lang-1', 2, 2);

      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(2);
    });
  });
});
