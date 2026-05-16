import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScenariosListingService } from './scenarios-listing.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';

const makeRow = (overrides: Partial<{
  id: string; title: string; type: string; source: string;
  cat_id: string; cat_name: string; cat_slug: string; cat_order: number;
  access_tier: string; sort_at: Date; description: string; image_url: string;
  language_id: string;
}> = {}) => ({
  id: 'scenario-1',
  title: 'Test Scenario',
  description: 'A description',
  image_url: null,
  language_id: 'lang-1',
  access_tier: AccessTier.FREE,
  type: 'system',
  source: 'system',
  sort_at: new Date('2026-04-01'),
  cat_id: 'cat-1',
  cat_name: 'Daily Life',
  cat_slug: 'daily_life',
  cat_order: 1,
  ...overrides,
});

describe('ScenariosListingService', () => {
  let service: ScenariosListingService;
  let userLangRepo: { manager: { query: jest.Mock } };
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'isUserPremium'>>;

  beforeEach(async () => {
    const queryMock = jest.fn().mockImplementation((sql: string) => {
      if (sql.trim().toUpperCase().startsWith('UPDATE')) return Promise.resolve();
      return Promise.resolve([]);
    });
    userLangRepo = { manager: { query: queryMock } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosListingService,
        {
          provide: getRepositoryToken(UserLanguage),
          useValue: userLangRepo as unknown as Repository<UserLanguage>,
        },
        {
          provide: SubscriptionService,
          useValue: { isUserPremium: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();

    service = module.get(ScenariosListingService);
    subscriptionService = module.get(SubscriptionService);
  });

  describe('listGrouped', () => {
    it('returns empty items when no visible scenarios', async () => {
      userLangRepo.manager.query.mockResolvedValue([]);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('groups scenarios by category', async () => {
      const rows = [
        makeRow({ id: 's1', cat_id: 'cat-1', cat_name: 'Daily Life', cat_order: 1 }),
        makeRow({ id: 's2', cat_id: 'cat-1', cat_name: 'Daily Life', cat_order: 1, sort_at: new Date('2026-04-02') }),
        makeRow({ id: 's3', cat_id: 'cat-2', cat_name: 'Travel', cat_slug: 'travel', cat_order: 2 }),
      ];
      userLangRepo.manager.query.mockResolvedValue(rows);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].category.slug).toBe('daily_life');
      expect(result.items[0].scenarios).toHaveLength(2);
      expect(result.items[1].category.slug).toBe('travel');
    });

    it('sorts categories by order_index ASC', async () => {
      const rows = [
        makeRow({ id: 's1', cat_id: 'cat-2', cat_name: 'Travel', cat_slug: 'travel', cat_order: 2 }),
        makeRow({ id: 's2', cat_id: 'cat-1', cat_name: 'Daily Life', cat_slug: 'daily_life', cat_order: 1 }),
      ];
      userLangRepo.manager.query.mockResolvedValue(rows);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      expect(result.items[0].category.orderIndex).toBe(1);
      expect(result.items[1].category.orderIndex).toBe(2);
    });

    it('sorts scenarios within category by addedAt DESC', async () => {
      const rows = [
        makeRow({ id: 's1', cat_id: 'cat-1', sort_at: new Date('2026-04-01') }),
        makeRow({ id: 's2', cat_id: 'cat-1', sort_at: new Date('2026-04-10') }),
      ];
      userLangRepo.manager.query.mockResolvedValue(rows);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      expect(result.items[0].scenarios[0].id).toBe('s2');
      expect(result.items[0].scenarios[1].id).toBe('s1');
    });

    it('marks premium scenarios locked for free users', async () => {
      jest.spyOn(subscriptionService, 'isUserPremium').mockResolvedValue(false);
      userLangRepo.manager.query.mockResolvedValue([
        makeRow({ id: 's1', access_tier: AccessTier.PREMIUM }),
      ]);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      const item = result.items[0].scenarios[0];
      expect(item.locked).toBe(true);
      expect(item.description).toBeUndefined();
      expect(item.imageUrl).toBeUndefined();
    });

    it('does not lock premium scenarios for premium users', async () => {
      jest.spyOn(subscriptionService, 'isUserPremium').mockResolvedValue(true);
      userLangRepo.manager.query.mockResolvedValue([
        makeRow({ id: 's1', access_tier: AccessTier.PREMIUM }),
      ]);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);

      expect(result.items[0].scenarios[0].locked).toBeUndefined();
    });

    it('paginates over categories', async () => {
      const rows = [
        makeRow({ id: 's1', cat_id: 'cat-1', cat_order: 1 }),
        makeRow({ id: 's2', cat_id: 'cat-2', cat_order: 2, cat_slug: 'travel' }),
        makeRow({ id: 's3', cat_id: 'cat-3', cat_order: 3, cat_slug: 'food' }),
      ];
      userLangRepo.manager.query.mockResolvedValue(rows);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 2);

      expect(result.pagination.total).toBe(3);
      expect(result.items).toHaveLength(2);
    });

    it('hides categories with zero visible scenarios (empty cat_id impossible from query, but handles gracefully)', async () => {
      userLangRepo.manager.query.mockResolvedValue([]);
      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);
      expect(result.items).toHaveLength(0);
    });

    it('includes source field correctly for kol and personalized', async () => {
      const rows = [
        makeRow({ id: 's1', type: 'kol', source: 'kol' }),
        makeRow({ id: 's2', type: 'personal', source: 'personalized', cat_id: 'cat-1' }),
      ];
      userLangRepo.manager.query.mockResolvedValue(rows);

      const result = await service.listGrouped('user-1', 'lang-1', 1, 20);
      const scenarios = result.items[0].scenarios;
      const sources = scenarios.map((s) => s.source);
      expect(sources).toContain('kol');
      expect(sources).toContain('personalized');
    });
  });
});
