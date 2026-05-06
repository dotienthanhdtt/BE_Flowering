import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '@/database/entities/user.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { PersonalizationDedupService } from './personalization-dedup.service';

const mockScenarioRepo = () => ({
  find: jest.fn(),
});

describe('PersonalizationDedupService', () => {
  let service: PersonalizationDedupService;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizationDedupService,
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
      ],
    }).compile();

    service = module.get(PersonalizationDedupService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
  });

  afterEach(() => jest.clearAllMocks());

  describe('shouldSkipGeneration', () => {
    describe('no snapshot (null)', () => {
      it('should NOT skip when user has no prior personalization', () => {
        const user = {
          lastPersonalizationAt: null,
          personalizationProfileSnapshot: null,
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish', level: 'B1' };

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false);
      });
    });

    describe('24h dedup window', () => {
      it('should NOT skip when last personalization >24h ago', () => {
        const now = new Date();
        const dayAndAHalf = new Date(now.getTime() - 36 * 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: dayAndAHalf,
          personalizationProfileSnapshot: { language: 'Spanish' },
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish' }; // Same profile

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false);
      });

      it('should potentially skip when last personalization <24h ago (if profile unchanged)', () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: oneHourAgo,
          personalizationProfileSnapshot: { language: 'Spanish', level: 'B1' },
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish', level: 'B1' }; // Identical

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(true); // Should skip because profile unchanged AND <24h
      });

      it('should NOT skip when profile changed even if <24h', () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: oneHourAgo,
          personalizationProfileSnapshot: { language: 'Spanish', level: 'B1' },
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish', level: 'B2' }; // Level changed

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false); // Should NOT skip because profile changed
      });
    });

    describe('profile diff: new keys', () => {
      it('should NOT skip when fresh profile has new keys not in snapshot', () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: oneHourAgo,
          personalizationProfileSnapshot: { language: 'Spanish' },
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish', level: 'B1' }; // Added 'level'

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false); // New key = profile changed
      });
    });

    describe('profile diff: value changes', () => {
      it('should NOT skip when value changed for existing key', () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: oneHourAgo,
          personalizationProfileSnapshot: { language: 'Spanish', level: 'B1' },
        } as Partial<User> as User;
        const freshProfile = { language: 'Spanish', level: 'B2' };

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false);
      });

      it('should handle nested objects in profile diff', () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const user = {
          lastPersonalizationAt: oneHourAgo,
          personalizationProfileSnapshot: { goals: { career: true, travel: false } },
        } as Partial<User> as User;
        const freshProfile = { goals: { career: true, travel: true } }; // Nested value changed

        const result = service.shouldSkipGeneration(user, freshProfile);

        expect(result).toBe(false);
      });
    });
  });

  describe('computeProfileDiff', () => {
    it('should return hasNew=true when snapshot is null', () => {
      const fresh = { language: 'Spanish', level: 'B1' };

      const diff = service.computeProfileDiff(null, fresh);

      expect(diff).toEqual({ hasNew: true, addedKeys: ['language', 'level'] });
    });

    it('should return hasNew=true when fresh has new keys', () => {
      const snapshot = { language: 'Spanish' };
      const fresh = { language: 'Spanish', level: 'B1' };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: true, addedKeys: ['level'] });
    });

    it('should return hasNew=false when profiles are identical', () => {
      const snapshot = { language: 'Spanish', level: 'B1' };
      const fresh = { language: 'Spanish', level: 'B1' };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: false, addedKeys: [] });
    });

    it('should detect value changes on existing keys', () => {
      const snapshot = { language: 'Spanish', level: 'B1' };
      const fresh = { language: 'Spanish', level: 'B2' };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: true, addedKeys: [] });
    });

    it('should ignore keys in snapshot not in fresh (removal is not "new")', () => {
      const snapshot = { language: 'Spanish', level: 'B1', proficiency: 'intermediate' };
      const fresh = { language: 'Spanish', level: 'B1' };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: false, addedKeys: [] });
    });

    it('should handle complex nested objects', () => {
      const snapshot = { goals: { career: true, travel: false }, interests: ['business'] };
      const fresh = { goals: { career: true, travel: false }, interests: ['business'] };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: false, addedKeys: [] });
    });

    it('should detect changes in nested object values', () => {
      const snapshot = { goals: { career: true, travel: false } };
      const fresh = { goals: { career: true, travel: true } };

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: true, addedKeys: [] });
    });

    it('should detect changes in array order or content', () => {
      const snapshot = { interests: ['business', 'travel'] };
      const fresh = { interests: ['travel', 'business'] }; // Different order

      const diff = service.computeProfileDiff(snapshot, fresh);

      expect(diff).toEqual({ hasNew: true, addedKeys: [] });
    });
  });

  describe('getRecentPersonalScenarios', () => {
    it('should return 5 most recent personal scenarios by default', async () => {
      const userId = 'user-1';
      const scenarios = [
        {
          id: '1',
          ownerId: userId,
          type: ScenarioType.PERSONAL,
          status: ContentStatus.PUBLISHED,
          createdAt: new Date('2026-05-04'),
        },
        {
          id: '2',
          ownerId: userId,
          type: ScenarioType.PERSONAL,
          status: ContentStatus.PUBLISHED,
          createdAt: new Date('2026-05-03'),
        },
      ] as Scenario[];

      scenarioRepo.find.mockResolvedValue(scenarios);

      const result = await service.getRecentPersonalScenarios(userId);

      expect(result).toEqual(scenarios);
      expect(scenarioRepo.find).toHaveBeenCalledWith({
        where: {
          ownerId: userId,
          type: ScenarioType.PERSONAL,
          status: ContentStatus.PUBLISHED,
        },
        order: { createdAt: 'DESC' },
        take: 5,
      });
    });

    it('should respect custom limit parameter', async () => {
      const userId = 'user-1';
      scenarioRepo.find.mockResolvedValue([]);

      await service.getRecentPersonalScenarios(userId, 10);

      expect(scenarioRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('should order by createdAt DESC (most recent first)', async () => {
      const userId = 'user-1';
      scenarioRepo.find.mockResolvedValue([]);

      await service.getRecentPersonalScenarios(userId);

      expect(scenarioRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' } }),
      );
    });

    it('should only return PUBLISHED personal scenarios', async () => {
      const userId = 'user-1';
      scenarioRepo.find.mockResolvedValue([]);

      await service.getRecentPersonalScenarios(userId);

      expect(scenarioRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ownerId: userId,
            type: ScenarioType.PERSONAL,
            status: ContentStatus.PUBLISHED,
          },
        }),
      );
    });
  });
});
