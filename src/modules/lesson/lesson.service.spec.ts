import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectQueryBuilder } from 'typeorm';
import { LessonService } from './lesson.service';
import { Scenario, ScenarioDifficulty } from '../../database/entities/scenario.entity';

import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { ScenarioCategory } from '../../database/entities/scenario-category.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { ScenarioStatus } from './dto/lesson-response.dto';

// Mock repositories
const mockScenarioRepo = () => ({
  createQueryBuilder: jest.fn(),
});


const mockSubscriptionRepo = () => ({
  findOne: jest.fn(),
});

const mockSubscriptionService = () => ({
  isSubscriptionActive: jest.fn(),
});

describe('LessonService', () => {
  let service: LessonService;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;
  let subscriptionRepo: ReturnType<typeof mockSubscriptionRepo>;
  let subscriptionService: ReturnType<typeof mockSubscriptionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonService,
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
        { provide: getRepositoryToken(Subscription), useFactory: mockSubscriptionRepo },
        { provide: SubscriptionService, useFactory: mockSubscriptionService },
      ],
    }).compile();

    service = module.get<LessonService>(LessonService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    subscriptionRepo = module.get(getRepositoryToken(Subscription));
    subscriptionService = module.get(SubscriptionService);
    // Default: isSubscriptionActive returns true for any non-null subscription
    subscriptionService.isSubscriptionActive.mockImplementation(
      (sub: Subscription) => sub.status === SubscriptionStatus.ACTIVE,
    );
  });

  // Helper: Create mock category
  const mockCategory = (id: string = 'cat-1', name: string = 'Category 1'): ScenarioCategory => ({
    id,
    name,
    orderIndex: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Helper: Create mock scenario
  const mockScenario = (
    id: string = 'scenario-1',
    category: ScenarioCategory = mockCategory(),
    overrides?: Partial<Scenario>,
  ): Scenario => ({
    id,
    category,
    categoryId: category.id,
    title: 'Test Scenario',
    description: 'Test Description',
    imageUrl: 'https://example.com/image.jpg',
    difficulty: ScenarioDifficulty.BEGINNER,
    isPremium: false,
    isTrial: false,
    isActive: true,
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Helper: Create mock query builder
  const createMockQueryBuilder = () => {
    const mockSubQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getQuery: jest.fn().mockReturnValue('(SELECT access.scenario_id FROM user_scenario_access access WHERE access.user_id = :userId)'),
    };

    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
      subQuery: jest.fn().mockReturnValue(mockSubQueryBuilder),
      getQuery: jest.fn().mockReturnValue('SELECT * FROM user_scenario_access WHERE user_id = :userId'),
    } as unknown as SelectQueryBuilder<Scenario>;

    return queryBuilder;
  };

  describe('getLessons', () => {
    const userId = 'user-1';

    describe('Visibility - Global Scenarios', () => {
      it('should return global scenarios (language_id IS NULL)', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category), mockScenario('s-2', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(2);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Free user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(queryBuilder.where).toHaveBeenCalledWith('scenario.is_active = true');
        expect(result.pagination.total).toBe(2);
        expect(result.categories).toHaveLength(1);
        expect(result.categories[0].scenarios).toHaveLength(2);
      });

      it('should apply language filter when provided', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const langId = 'lang-1';
        const scenarios = [mockScenario('s-1', category, { languageId: langId })];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { language: langId, page: 1, limit: 20 };
        await service.getLessons(userId, query);

        // Should apply visibility query with language filter
        expect(queryBuilder.andWhere).toHaveBeenCalled();
        const andWhereCall = (queryBuilder.andWhere as jest.Mock).mock.calls[0];
        expect(andWhereCall[0]).toContain('language_id IS NULL');
        expect(andWhereCall[0]).toContain('language_id = :languageId');
        expect(andWhereCall[1]).toEqual({ languageId: langId, userId });
      });

      it('should include user-granted access scenarios without language filter', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        await service.getLessons(userId, query);

        // Should apply visibility query that includes user access subquery
        expect(queryBuilder.andWhere).toHaveBeenCalled();
        const andWhereCall = (queryBuilder.andWhere as jest.Mock).mock.calls[0];
        expect(andWhereCall[0]).toContain('language_id IS NULL');
        expect(andWhereCall[0]).toContain('IN (');
      });
    });

    describe('Filters - Level', () => {
      it('should filter scenarios by difficulty level', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { difficulty: ScenarioDifficulty.INTERMEDIATE }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = {
          level: ScenarioDifficulty.INTERMEDIATE,
          page: 1,
          limit: 20,
        };
        await service.getLessons(userId, query);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith('scenario.difficulty = :level', {
          level: ScenarioDifficulty.INTERMEDIATE,
        });
      });

      it('should not apply level filter if not provided', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        await service.getLessons(userId, query);

        // Should not have called andWhere for difficulty filter
        const andWhereCalls = (queryBuilder.andWhere as jest.Mock).mock.calls;
        const hasLevelFilter = andWhereCalls.some((call) => call[0]?.includes('difficulty'));
        expect(hasLevelFilter).toBe(false);
      });
    });

    describe('Filters - Search', () => {
      it('should filter scenarios by title search (ILIKE)', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category, { title: 'Restaurant Conversation' })];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { search: 'Restaurant', page: 1, limit: 20 };
        await service.getLessons(userId, query);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith('scenario.title ILIKE :search', {
          search: '%Restaurant%',
        });
      });

      it('should not apply search filter if not provided', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        await service.getLessons(userId, query);

        const andWhereCalls = (queryBuilder.andWhere as jest.Mock).mock.calls;
        const hasSearchFilter = andWhereCalls.some((call) => call[0]?.includes('ILIKE'));
        expect(hasSearchFilter).toBe(false);
      });

      it('should handle empty search string gracefully', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { search: '', page: 1, limit: 20 };
        await service.getLessons(userId, query);

        // Empty string is falsy, so filter should not be applied
        const andWhereCalls = (queryBuilder.andWhere as jest.Mock).mock.calls;
        const hasSearchFilter = andWhereCalls.some((call) => call[0]?.includes('ILIKE'));
        expect(hasSearchFilter).toBe(false);
      });
    });

    describe('Status - Locked (Premium + Free User)', () => {
      it('should return LOCKED status for premium scenario with free user (non-trial)', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: true, isTrial: false }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Free user (no subscription)

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.LOCKED);
      });

      it('should not lock premium scenario for paid user', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: true, isTrial: false }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue({
          userId,
          plan: SubscriptionPlan.MONTHLY,
          status: SubscriptionStatus.ACTIVE,
        } as Subscription); // Paid user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.AVAILABLE);
      });
    });

    describe('Status - Trial', () => {
      it('should return TRIAL status for trial scenario with free user', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: false, isTrial: true }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Free user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.TRIAL);
      });

      it('should return AVAILABLE (not TRIAL) for trial scenario with paid user', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: false, isTrial: true }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue({
          userId,
          plan: SubscriptionPlan.YEARLY,
          status: SubscriptionStatus.ACTIVE,
        } as Subscription); // Paid user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.AVAILABLE);
      });

      it('should return TRIAL (not LOCKED) for premium+trial scenario with free user', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: true, isTrial: true }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Free user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        // Should be TRIAL, not LOCKED (isTrial takes precedence)
        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.TRIAL);
      });
    });

    describe('Status - Available', () => {
      it('should return AVAILABLE for non-premium scenario', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: false, isTrial: false }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Free user

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.AVAILABLE);
      });

      it('should return AVAILABLE for any scenario with lifetime subscription', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, { isPremium: true, isTrial: false }),
          mockScenario('s-2', category, { isPremium: false, isTrial: true }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(2);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue({
          userId,
          plan: SubscriptionPlan.LIFETIME,
          status: SubscriptionStatus.ACTIVE,
        } as Subscription); // Paid user with lifetime

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.AVAILABLE);
        expect(result.categories[0].scenarios[1].status).toBe(ScenarioStatus.AVAILABLE);
      });
    });

    describe('Grouping by Category', () => {
      it('should group scenarios by category', async () => {
        const cat1 = mockCategory('cat-1', 'Conversation');
        const cat2 = mockCategory('cat-2', 'Grammar');
        const scenarios = [
          mockScenario('s-1', cat1),
          mockScenario('s-2', cat1),
          mockScenario('s-3', cat2),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(3);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories).toHaveLength(2);
        expect(result.categories[0].name).toBe('Conversation');
        expect(result.categories[0].scenarios).toHaveLength(2);
        expect(result.categories[1].name).toBe('Grammar');
        expect(result.categories[1].scenarios).toHaveLength(1);
      });

      it('should preserve category metadata (id, name)', async () => {
        const category = mockCategory('cat-1', 'Advanced Conversations');
        const scenarios = [mockScenario('s-1', category)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].id).toBe('cat-1');
        expect(result.categories[0].name).toBe('Advanced Conversations');
      });

      it('should handle scenarios without images', async () => {
        const category = mockCategory('cat-1', 'No Image Category');
        const scenarios = [mockScenario('s-1', category, { imageUrl: undefined })];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories[0].scenarios[0].imageUrl).toBeNull();
      });
    });

    describe('Pagination', () => {
      it('should apply default pagination (page=1, limit=20)', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = Array.from({ length: 20 }, (_, i) =>
          mockScenario(`s-${i + 1}`, category),
        );
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(40);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = {}; // Defaults applied
        const result = await service.getLessons(userId, query);

        expect(queryBuilder.skip).toHaveBeenCalledWith(0); // (1-1) * 20
        expect(queryBuilder.take).toHaveBeenCalledWith(20);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(20);
        expect(result.pagination.total).toBe(40);
      });

      it('should calculate correct offset for page 2', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = Array.from({ length: 20 }, (_, i) =>
          mockScenario(`s-${i + 21}`, category),
        );
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(50);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 2, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(queryBuilder.skip).toHaveBeenCalledWith(20); // (2-1) * 20
        expect(queryBuilder.take).toHaveBeenCalledWith(20);
        expect(result.pagination.page).toBe(2);
        expect(result.pagination.total).toBe(50);
      });

      it('should handle custom limit', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = Array.from({ length: 10 }, (_, i) =>
          mockScenario(`s-${i + 1}`, category),
        );
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(25);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 10 };
        const result = await service.getLessons(userId, query);

        expect(queryBuilder.skip).toHaveBeenCalledWith(0);
        expect(queryBuilder.take).toHaveBeenCalledWith(10);
        expect(result.pagination.limit).toBe(10);
        expect(result.pagination.total).toBe(25);
      });

      it('should return correct total count independent of pagination', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        // Only 5 scenarios on this page, but 100 total
        const scenarios = Array.from({ length: 5 }, (_, i) =>
          mockScenario(`s-${i + 96}`, category),
        );
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(100); // Total before pagination
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 5, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.pagination.total).toBe(100);
        expect(result.categories[0].scenarios).toHaveLength(5); // Only 5 on this page
      });
    });

    describe('Ordering', () => {
      it('should order by category orderIndex then scenario orderIndex', async () => {
        const cat1 = mockCategory('cat-1', 'Conversation');
        cat1.orderIndex = 0;
        const cat2 = mockCategory('cat-2', 'Grammar');
        cat2.orderIndex = 1;
        const scenarios = [
          mockScenario('s-1', cat1, { orderIndex: 0 }),
          mockScenario('s-2', cat1, { orderIndex: 1 }),
          mockScenario('s-3', cat2, { orderIndex: 0 }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(3);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        await service.getLessons(userId, query);

        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('cat.orderIndex', 'ASC');
        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('scenario.orderIndex', 'ASC');
      });
    });

    describe('Combined Filters', () => {
      it('should apply language + level + search filters together', async () => {
        const langId = 'lang-1';
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [
          mockScenario('s-1', category, {
            languageId: langId,
            difficulty: ScenarioDifficulty.ADVANCED,
            title: 'Advanced Restaurant',
          }),
        ];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = {
          language: langId,
          level: ScenarioDifficulty.ADVANCED,
          search: 'Restaurant',
          page: 1,
          limit: 20,
        };
        await service.getLessons(userId, query);

        // Should apply all three filters
        const andWhereCalls = (queryBuilder.andWhere as jest.Mock).mock.calls;
        expect(andWhereCalls.length).toBeGreaterThanOrEqual(3); // visibility + level + search
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty results', async () => {
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(0);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue([]);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.categories).toEqual([]);
        expect(result.pagination.total).toBe(0);
      });

      it('should handle null subscription (free user)', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category, { isPremium: true })];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null); // Null subscription

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        // Null subscription should be treated as free user
        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.LOCKED);
      });

      it('should treat subscription with plan=FREE as free user', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = [mockScenario('s-1', category, { isPremium: true })];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue({
          userId,
          plan: SubscriptionPlan.FREE,
        } as Subscription);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        // FREE plan should be treated as free user
        expect(result.categories[0].scenarios[0].status).toBe(ScenarioStatus.LOCKED);
      });

      it('should handle multiple categories with same order index', async () => {
        const cat1 = mockCategory('cat-1', 'Conversation');
        cat1.orderIndex = 0;
        const cat2 = mockCategory('cat-2', 'Grammar');
        cat2.orderIndex = 0; // Same order index
        const scenarios = [mockScenario('s-1', cat1), mockScenario('s-2', cat2)];
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(2);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios);
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        // Should still group correctly despite same order index
        expect(result.categories).toHaveLength(2);
        expect(result.categories[0].scenarios[0].id).toBe('s-1');
        expect(result.categories[1].scenarios[0].id).toBe('s-2');
      });

      it('should handle large number of scenarios', async () => {
        const category = mockCategory('cat-1', 'Conversation');
        const scenarios = Array.from({ length: 1000 }, (_, i) =>
          mockScenario(`s-${i + 1}`, category, {
            title: `Scenario ${i + 1}`,
            orderIndex: i,
          }),
        );
        const queryBuilder = createMockQueryBuilder();

        scenarioRepo.createQueryBuilder.mockReturnValue(queryBuilder);

        (queryBuilder.getCount as jest.Mock).mockResolvedValue(1000);
        (queryBuilder.getMany as jest.Mock).mockResolvedValue(scenarios.slice(0, 20)); // Return first 20
        subscriptionRepo.findOne.mockResolvedValue(null);

        const query: GetLessonsQueryDto = { page: 1, limit: 20 };
        const result = await service.getLessons(userId, query);

        expect(result.pagination.total).toBe(1000);
        expect(result.categories[0].scenarios).toHaveLength(20);
      });
    });
  });
});
