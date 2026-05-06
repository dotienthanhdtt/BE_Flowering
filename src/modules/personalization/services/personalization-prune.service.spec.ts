import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { PersonalizationPruneService } from './personalization-prune.service';

const mockScenarioRepo = () => ({
  manager: {
    query: jest.fn(),
  },
});

describe('PersonalizationPruneService', () => {
  let service: PersonalizationPruneService;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizationPruneService,
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
      ],
    }).compile();

    service = module.get(PersonalizationPruneService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
  });

  afterEach(() => jest.clearAllMocks());

  describe('pruneIfNeeded', () => {
    it('should execute DELETE query for unused scenarios over cap (30)', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query, params] = scenarioRepo.manager.query.mock.calls[0];

      // Verify query structure
      expect(query).toContain('DELETE FROM scenarios');
      expect(query).toContain('LEFT JOIN ai_conversations c ON c.scenario_id = s.id');
      expect(query).toContain('WHERE s.owner_id = $1');
      expect(query).toContain("AND s.type = 'personal'");
      expect(query).toContain('HAVING COUNT(c.id) = 0');
      expect(query).toContain('ORDER BY s.created_at ASC');
      expect(query).toContain('OFFSET $2');

      // Verify parameters
      expect(params).toEqual([userId, 30]);
    });

    it('should handle empty result gracefully', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue(null);

      await expect(service.pruneIfNeeded(userId)).resolves.not.toThrow();
    });

    it('should log warning and continue when query fails', async () => {
      const userId = 'user-1';
      const error = new Error('Database connection lost');
      scenarioRepo.manager.query.mockRejectedValue(error);

      // Service should not throw; errors are swallowed
      await expect(service.pruneIfNeeded(userId)).resolves.not.toThrow();
    });

    it('should delete only UNUSED scenarios (count(c.id) = 0)', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query] = scenarioRepo.manager.query.mock.calls[0];

      // HAVING COUNT(c.id) = 0 filters for unused scenarios
      expect(query).toContain('HAVING COUNT(c.id) = 0');
    });

    it('should order by created_at ASC to delete oldest first', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query] = scenarioRepo.manager.query.mock.calls[0];

      // Oldest scenarios should be deleted first
      expect(query).toContain('ORDER BY s.created_at ASC');
    });

    it('should use OFFSET to keep cap (30 scenarios)', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query, params] = scenarioRepo.manager.query.mock.calls[0];

      // OFFSET 30 means keep first 30 (ordered by created_at ASC = oldest 30)
      expect(query).toContain('OFFSET $2');
      expect(params[1]).toBe(30);
    });

    it('should only delete PERSONAL type scenarios (s.type = \'personal\')', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query] = scenarioRepo.manager.query.mock.calls[0];

      expect(query).toContain("s.type = 'personal'");
    });

    it('should only delete scenarios for the specific user', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query, params] = scenarioRepo.manager.query.mock.calls[0];

      expect(query).toContain('s.owner_id = $1');
      expect(params[0]).toBe(userId);
    });

    it('should group by (s.id, s.created_at) for correct deduplication', async () => {
      const userId = 'user-1';
      scenarioRepo.manager.query.mockResolvedValue({});

      await service.pruneIfNeeded(userId);

      const [query] = scenarioRepo.manager.query.mock.calls[0];

      expect(query).toContain('GROUP BY s.id, s.created_at');
    });
  });
});
