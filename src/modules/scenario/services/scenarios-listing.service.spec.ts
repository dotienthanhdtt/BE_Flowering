import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ScenariosListingService } from './scenarios-listing.service';
import { ScenarioAccessService } from './scenario-access.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';

const mockScenario = (id: string, overrides?: Partial<Scenario>): Scenario =>
  ({
    id,
    type: ScenarioType.SYSTEM,
    title: `Scenario ${id}`,
    description: `Description for ${id}`,
    imageUrl: 'https://example.com/image.jpg',
    languageId: 'lang-1',
    orderIndex: 0,
    categoryId: 'cat-1',
    accessTier: AccessTier.FREE,
    status: ContentStatus.PUBLISHED,
    triggersPersonalization: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Scenario;

const mockKolQueryBuilder = (entities: Scenario[] = [], raw: unknown[] = []) =>
  ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
  }) as unknown as SelectQueryBuilder<Scenario>;

describe('ScenariosListingService', () => {
  let service: ScenariosListingService;
  let scenarioRepo: jest.Mocked<Repository<Scenario>>;
  let accessService: jest.Mocked<Pick<ScenarioAccessService, 'listPublicByType' | 'listPersonalForUser'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'isUserPremium'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosListingService,
        {
          provide: getRepositoryToken(Scenario),
          useValue: {
            findAndCount: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          } as unknown as Repository<Scenario>,
        },
        {
          provide: getRepositoryToken(UserLanguage),
          useValue: {
            manager: {
              transaction: jest.fn(async (cb: (mgr: unknown) => Promise<void>) => {
                const repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
                await cb({ getRepository: () => repo });
              }),
            },
          } as unknown as Repository<UserLanguage>,
        },
        {
          provide: ScenarioAccessService,
          useValue: {
            listPublicByType: jest.fn(),
            listPersonalForUser: jest.fn(),
          },
        },
        {
          provide: SubscriptionService,
          useValue: { isUserPremium: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();

    service = module.get(ScenariosListingService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    accessService = module.get(ScenarioAccessService);
    subscriptionService = module.get(SubscriptionService);
  });

  describe('listDefault', () => {
    it('returns paginated items via ScenarioAccessService', async () => {
      const scenarios = [mockScenario('s1', { orderIndex: 1 }), mockScenario('s2', { orderIndex: 2 })];
      jest.spyOn(accessService, 'listPublicByType').mockResolvedValue({ items: scenarios, total: 2 });

      const result = await service.listDefault('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('s1');
    });

    it('calls listPublicByType with SYSTEM type', async () => {
      jest.spyOn(accessService, 'listPublicByType').mockResolvedValue({ items: [], total: 0 });

      await service.listDefault('user-1', 'lang-1', 1, 10);

      expect(accessService.listPublicByType).toHaveBeenCalledWith(ScenarioType.SYSTEM, 'lang-1', 1, 10);
    });

    it('marks premium scenarios as locked for free users', async () => {
      const premiumScenario = mockScenario('s1', { accessTier: AccessTier.PREMIUM });
      jest.spyOn(accessService, 'listPublicByType').mockResolvedValue({ items: [premiumScenario], total: 1 });
      jest.spyOn(subscriptionService, 'isUserPremium').mockResolvedValue(false);

      const result = await service.listDefault('user-1', 'lang-1', 1, 10);

      expect(result.items[0].locked).toBe(true);
    });

    it('does not lock premium scenarios for premium users', async () => {
      const premiumScenario = mockScenario('s1', { accessTier: AccessTier.PREMIUM });
      jest.spyOn(accessService, 'listPublicByType').mockResolvedValue({ items: [premiumScenario], total: 1 });
      jest.spyOn(subscriptionService, 'isUserPremium').mockResolvedValue(true);

      const result = await service.listDefault('user-1', 'lang-1', 1, 10);

      expect(result.items[0].locked).toBeUndefined();
    });
  });

  describe('listPersonal', () => {
    it('merges personal and KOL scenarios sorted by addedAt DESC', async () => {
      const ai1 = mockScenario('ai-1', { type: ScenarioType.PERSONAL, createdAt: new Date('2026-04-15') });
      const ai2 = mockScenario('ai-2', { type: ScenarioType.PERSONAL, createdAt: new Date('2026-04-20') });
      jest.spyOn(accessService, 'listPersonalForUser').mockResolvedValue([ai1, ai2]);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(
        mockKolQueryBuilder(
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

    it('handles empty personal scenarios', async () => {
      jest.spyOn(accessService, 'listPersonalForUser').mockResolvedValue([]);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(
        mockKolQueryBuilder([mockScenario('kol-1')], [{ s_id: 'kol-1' }]),
      );

      const result = await service.listPersonal('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.items[0].source).toBe('kol');
    });

    it('handles empty KOL access', async () => {
      const ai1 = mockScenario('ai-1', { type: ScenarioType.PERSONAL, createdAt: new Date() });
      jest.spyOn(accessService, 'listPersonalForUser').mockResolvedValue([ai1]);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(mockKolQueryBuilder());

      const result = await service.listPersonal('user-1', 'lang-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.items[0].source).toBe('personalized');
    });

    it('applies pagination to merged results', async () => {
      const aiScenarios = Array.from({ length: 5 }, (_, i) =>
        mockScenario(`ai-${i}`, { type: ScenarioType.PERSONAL, createdAt: new Date(Date.now() - i * 1000) }),
      );
      jest.spyOn(accessService, 'listPersonalForUser').mockResolvedValue(aiScenarios);
      jest.spyOn(scenarioRepo, 'createQueryBuilder').mockReturnValue(mockKolQueryBuilder());

      const result = await service.listPersonal('user-1', 'lang-1', 2, 2);

      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(2);
    });
  });
});
