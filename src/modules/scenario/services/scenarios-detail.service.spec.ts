import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScenariosDetailService } from './scenarios-detail.service';
import { ScenarioAccessService } from './scenario-access.service';
import { UserAiScenario } from '../../../database/entities/user-ai-scenario.entity';
import { AccessTier } from '../../../database/entities/access-tier.enum';
import { ScenarioDifficulty } from '../../../database/entities/scenario.entity';
import { ContentStatus } from '../../../database/entities/content-status.enum';

const mockAccessService = () => ({ checkAccess: jest.fn() });
const mockUserAiScenarioRepo = () => ({ findOne: jest.fn() });

describe('ScenariosDetailService', () => {
  let service: ScenariosDetailService;
  let accessService: ReturnType<typeof mockAccessService>;
  let userAiScenarioRepo: ReturnType<typeof mockUserAiScenarioRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosDetailService,
        { provide: ScenarioAccessService, useFactory: mockAccessService },
        { provide: getRepositoryToken(UserAiScenario), useFactory: mockUserAiScenarioRepo },
      ],
    }).compile();

    service = module.get<ScenariosDetailService>(ScenariosDetailService);
    accessService = module.get(ScenarioAccessService);
    userAiScenarioRepo = module.get(getRepositoryToken(UserAiScenario));
  });

  const mockCategory = { id: 'cat-uuid', name: 'Restaurant' };
  const mockScenario = {
    id: 'scenario-uuid-1',
    title: 'Ordering Food',
    description: 'Learn how to order',
    imageUrl: undefined as string | undefined,
    difficulty: ScenarioDifficulty.BEGINNER,
    languageId: 'lang-uuid-en',
    orderIndex: 1,
    category: mockCategory,
    accessTier: AccessTier.FREE,
    status: ContentStatus.PUBLISHED,
  };

  const userId = 'user-uuid-1';
  const langId = 'lang-uuid-en';

  it('should return full DTO with isLocked=false for FREE tier', async () => {
    accessService.checkAccess.mockResolvedValue({ scenario: mockScenario, isLocked: false });

    const result = await service.get(userId, mockScenario.id, langId);

    expect(result.id).toBe(mockScenario.id);
    expect(result.isLocked).toBe(false);
    expect(result.lockReason).toBeUndefined();
    expect(result.category).toEqual(mockCategory);
  });

  it('should return isLocked=false for PREMIUM with active subscription', async () => {
    const premiumScenario = { ...mockScenario, accessTier: AccessTier.PREMIUM };
    accessService.checkAccess.mockResolvedValue({ scenario: premiumScenario, isLocked: false });

    const result = await service.get(userId, premiumScenario.id, langId);

    expect(result.isLocked).toBe(false);
    expect(result.accessTier).toBe(AccessTier.PREMIUM);
    expect(result.lockReason).toBeUndefined();
  });

  it('should return isLocked=true with lockReason for PREMIUM without access', async () => {
    const premiumScenario = { ...mockScenario, accessTier: AccessTier.PREMIUM };
    accessService.checkAccess.mockResolvedValue({
      scenario: premiumScenario,
      isLocked: true,
      lockReason: 'premium_required',
    });

    const result = await service.get(userId, premiumScenario.id, langId);

    expect(result.isLocked).toBe(true);
    expect(result.lockReason).toBe('premium_required');
  });

  it('should return isLocked=false for PREMIUM with explicit grant', async () => {
    const premiumScenario = { ...mockScenario, accessTier: AccessTier.PREMIUM };
    accessService.checkAccess.mockResolvedValue({ scenario: premiumScenario, isLocked: false });

    const result = await service.get(userId, premiumScenario.id, langId);

    expect(result.isLocked).toBe(false);
    expect(result.lockReason).toBeUndefined();
  });

  it('should propagate NotFoundException when no personal scenario fallback exists', async () => {
    accessService.checkAccess.mockRejectedValue(new NotFoundException('Scenario not found'));
    userAiScenarioRepo.findOne.mockResolvedValue(null);

    await expect(service.get(userId, 'non-existent-id', langId)).rejects.toThrow(NotFoundException);
  });

  it('should fall back to personal AI scenario when default lookup misses', async () => {
    accessService.checkAccess.mockRejectedValue(new NotFoundException('Scenario not found'));
    const personal = {
      id: 'personal-uuid-1',
      userId,
      languageId: langId,
      title: 'Ordering dim sum',
      description: 'Practice teahouse dialog',
      difficulty: ScenarioDifficulty.BEGINNER,
      createdAt: new Date(),
    };
    userAiScenarioRepo.findOne.mockResolvedValue(personal);

    const result = await service.get(userId, personal.id, langId);

    expect(userAiScenarioRepo.findOne).toHaveBeenCalledWith({
      where: { id: personal.id, userId, languageId: langId },
    });
    expect(result.id).toBe(personal.id);
    expect(result.title).toBe(personal.title);
    expect(result.accessTier).toBe(AccessTier.FREE);
    expect(result.isLocked).toBe(false);
    expect(result.userStatus).toBe('available');
    expect(result.source).toBe('personalized');
    expect(result.category).toBeUndefined();
  });
});
