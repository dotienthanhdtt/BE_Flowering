import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ScenariosDetailService } from './scenarios-detail.service';
import { ScenarioAccessService } from './scenario-access.service';
import { AccessTier } from '../../../database/entities/access-tier.enum';
import { ContentStatus } from '../../../database/entities/content-status.enum';

const mockAccessService = () => ({ checkAccess: jest.fn() });

describe('ScenariosDetailService', () => {
  let service: ScenariosDetailService;
  let accessService: ReturnType<typeof mockAccessService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosDetailService,
        { provide: ScenarioAccessService, useFactory: mockAccessService },
      ],
    }).compile();

    service = module.get<ScenariosDetailService>(ScenariosDetailService);
    accessService = module.get(ScenarioAccessService);
  });

  const mockCategory = { id: 'cat-uuid', name: 'Restaurant' };
  const mockScenario = {
    id: 'scenario-uuid-1',
    title: 'Ordering Food',
    description: 'Learn how to order',
    imageUrl: undefined as string | undefined,
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

  it('should propagate NotFoundException when scenario not found', async () => {
    accessService.checkAccess.mockRejectedValue(new NotFoundException('Scenario not found'));

    await expect(service.get(userId, 'non-existent-id', langId)).rejects.toThrow(NotFoundException);
  });
});
