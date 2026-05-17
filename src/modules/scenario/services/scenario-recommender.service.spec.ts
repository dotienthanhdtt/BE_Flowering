import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Scenario } from '../../../database/entities/scenario.entity';
import { AccessTier } from '../../../database/entities/access-tier.enum';
import { SubscriptionService } from '../../subscription/subscription.service';
import { ScenarioRecommenderService } from './scenario-recommender.service';

const mockScenarioRepo = () => ({
  query: jest.fn(),
});

const mockSubscriptionService = () => ({
  isUserPremium: jest.fn(),
});

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'scenario-1',
  title: 'Test Scenario',
  description: null,
  image_url: null,
  access_tier: AccessTier.FREE,
  category_pk: null,
  category_name: null,
  is_locked: false,
  ...overrides,
});

describe('ScenarioRecommenderService', () => {
  let service: ScenarioRecommenderService;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;
  let subscriptionService: ReturnType<typeof mockSubscriptionService>;

  const userId = 'user-1';
  const anchorScenarioId = 'anchor-1';
  const languageId = 'lang-1';
  const catA = 'cat-a';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioRecommenderService,
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
        { provide: SubscriptionService, useFactory: mockSubscriptionService },
      ],
    }).compile();

    service = module.get(ScenarioRecommenderService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    subscriptionService = module.get(SubscriptionService);

    subscriptionService.isUserPremium.mockResolvedValue(false);
  });

  // Case 1: 3 un-locked same-cat candidates — return top 2 by order_index (SQL handles ordering)
  it('case 1: returns top 2 of 3 un-locked same-cat candidates', async () => {
    const rows = [
      makeRow({ id: 's-1', is_locked: false, category_pk: catA }),
      makeRow({ id: 's-2', is_locked: false, category_pk: catA }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s-1');
    expect(result[0].is_locked).toBe(false);
    expect(result[0].category?.id).toBe(catA);
  });

  // Case 2: 1 un-locked same-cat, 2 un-locked diff-cat — returns same-cat then 1 diff-cat
  it('case 2: returns same-cat first then diff-cat', async () => {
    const rows = [
      makeRow({ id: 's-1', is_locked: false, category_pk: catA }),
      makeRow({ id: 's-2', is_locked: false, category_pk: 'cat-b' }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result[0].id).toBe('s-1');
    expect(result[1].id).toBe('s-2');
  });

  // Case 3: 0 un-locked, 2 locked same-cat (free user) — returns 2 locked same-cat
  it('case 3: returns locked same-cat candidates for free user', async () => {
    const rows = [
      makeRow({ id: 's-1', is_locked: true, access_tier: AccessTier.PREMIUM, category_pk: catA }),
      makeRow({ id: 's-2', is_locked: true, access_tier: AccessTier.PREMIUM, category_pk: catA }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result).toHaveLength(2);
    expect(result[0].is_locked).toBe(true);
    expect(result[1].is_locked).toBe(true);
  });

  // Case 4: anchor categoryId=null — all candidates treated as diff-cat (no same-cat tier)
  it('case 4: null anchor category treats all candidates as diff-cat', async () => {
    const rows = [
      makeRow({ id: 's-1', is_locked: false, category_pk: catA }),
      makeRow({ id: 's-2', is_locked: false, category_pk: null }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId });

    expect(result).toHaveLength(2);
    // SQL uses $4::uuid IS NOT NULL check, so with null anchor cat none qualify as same-cat
    expect(scenarioRepo.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([null]),
    );
  });

  // Case 5: Premium user — no is_locked true even for premium scenarios
  it('case 5: premium user never gets is_locked=true', async () => {
    subscriptionService.isUserPremium.mockResolvedValue(true);
    const rows = [
      makeRow({ id: 's-1', is_locked: false, access_tier: AccessTier.PREMIUM, category_pk: catA }),
      makeRow({ id: 's-2', is_locked: false, access_tier: AccessTier.PREMIUM, category_pk: null }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result.every((r) => r.is_locked === false)).toBe(true);
    // isPremium=true passed as $3 param
    expect(scenarioRepo.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([true]),
    );
  });

  // Case 6: premium scenario with explicit user_scenario_access — SQL returns is_locked=false
  it('case 6: explicit user_scenario_access unlocks scenario even when sub stub returns false', async () => {
    // The SQL evaluates is_locked based on user_scenario_access; mock returns is_locked=false
    const rows = [
      makeRow({ id: 's-1', is_locked: false, access_tier: AccessTier.PREMIUM }),
    ];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId });

    expect(result[0].is_locked).toBe(false);
  });

  // Case 7: all scenarios have DONE conversation — SQL returns [] (NOT EXISTS excludes them)
  it('case 7: returns [] when all other scenarios are DONE', async () => {
    scenarioRepo.query.mockResolvedValue([]);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result).toEqual([]);
  });

  // Case 8: anchor is only scenario in language — returns []
  it('case 8: returns [] when anchor is the only scenario in language', async () => {
    scenarioRepo.query.mockResolvedValue([]);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId });

    expect(result).toEqual([]);
  });

  // Case 9: candidate with CHATTING (non-DONE) conversation — still included
  it('case 9: includes candidate with non-DONE conversation status', async () => {
    const rows = [makeRow({ id: 's-chatting', is_locked: false })];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s-chatting');
  });

  // Case 10: language_id mismatch — SQL returns [] (WHERE s.language_id = $5 filters it)
  it('case 10: returns [] on language_id mismatch', async () => {
    scenarioRepo.query.mockResolvedValue([]);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId: 'other-lang' });

    expect(result).toEqual([]);
  });

  it('maps category correctly when category_pk is present', async () => {
    const rows = [makeRow({ id: 's-1', category_pk: catA, category_name: 'Shopping' })];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: catA, languageId });

    expect(result[0].category).toEqual({ id: catA, name: 'Shopping' });
  });

  it('sets category to null when category_pk is null', async () => {
    const rows = [makeRow({ id: 's-1', category_pk: null, category_name: null })];
    scenarioRepo.query.mockResolvedValue(rows);

    const result = await service.recommendNext({ userId, anchorScenarioId, anchorCategoryId: null, languageId });

    expect(result[0].category).toBeNull();
  });
});
