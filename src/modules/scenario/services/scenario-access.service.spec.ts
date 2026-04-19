import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ScenarioAccessService } from './scenario-access.service';
import { Scenario } from '../../../database/entities/scenario.entity';
import { UserScenarioAccess } from '../../../database/entities/user-scenario-access.entity';
import { SubscriptionService } from '../../subscription/subscription.service';

const mockScenarioRepo = () => ({
  findOne: jest.fn(),
});

const mockAccessRepo = () => ({
  findOne: jest.fn(),
});

const mockSubscriptionService = () => ({
  getUserSubscription: jest.fn(),
});

describe('ScenarioAccessService', () => {
  let service: ScenarioAccessService;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;
  let accessRepo: ReturnType<typeof mockAccessRepo>;
  let subscriptionService: ReturnType<typeof mockSubscriptionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioAccessService,
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
        { provide: getRepositoryToken(UserScenarioAccess), useFactory: mockAccessRepo },
        { provide: SubscriptionService, useFactory: mockSubscriptionService },
      ],
    }).compile();

    service = module.get<ScenarioAccessService>(ScenarioAccessService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    accessRepo = module.get(getRepositoryToken(UserScenarioAccess));
    subscriptionService = module.get(SubscriptionService);
  });

  const mockCategory = {
    id: 'cat-uuid',
    name: 'Restaurant',
  };

  const mockFreeScenario = {
    id: 'scenario-uuid-1',
    title: 'Ordering Food',
    description: 'Learn how to order at a restaurant',
    isPremium: false,
    isActive: true,
    category: mockCategory,
  };

  const mockPremiumScenario = {
    id: 'scenario-uuid-2',
    title: 'Luxury Hotel',
    description: 'Premium hotel scenario',
    isPremium: true,
    isActive: true,
    category: mockCategory,
  };

  const mockUserId = 'user-uuid-1';
  const mockActiveSubscription = {
    isActive: true,
  };

  describe('findAccessibleScenario', () => {
    it('should return scenario when free scenario and any user', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockFreeScenario);

      const result = await service.findAccessibleScenario(mockUserId, mockFreeScenario.id);

      expect(scenarioRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockFreeScenario.id, isActive: true, status: 'published' },
        relations: ['category'],
      });
      expect(result).toEqual(mockFreeScenario);
    });

    it('should return scenario when premium and user has active subscription', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockPremiumScenario);
      subscriptionService.getUserSubscription.mockResolvedValue(mockActiveSubscription);

      const result = await service.findAccessibleScenario(mockUserId, mockPremiumScenario.id);

      expect(scenarioRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockPremiumScenario.id, isActive: true, status: 'published' },
        relations: ['category'],
      });
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledWith(mockUserId);
      expect(result).toEqual(mockPremiumScenario);
    });

    it('should return scenario when premium and user has explicit access grant', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockPremiumScenario);
      subscriptionService.getUserSubscription.mockResolvedValue(null);
      accessRepo.findOne.mockResolvedValue({ userId: mockUserId, scenarioId: mockPremiumScenario.id });

      const result = await service.findAccessibleScenario(mockUserId, mockPremiumScenario.id);

      expect(result).toEqual(mockPremiumScenario);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledWith(mockUserId);
      expect(accessRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUserId, scenarioId: mockPremiumScenario.id },
      });
    });

    it('should throw NotFoundException when scenario not found', async () => {
      scenarioRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleScenario(mockUserId, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
      expect(scenarioRepo.findOne).toHaveBeenCalled();
    });

    it('should throw NotFoundException when scenario is inactive', async () => {
      scenarioRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleScenario(mockUserId, mockFreeScenario.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when premium scenario, user has no subscription or grant', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockPremiumScenario);
      subscriptionService.getUserSubscription.mockResolvedValue(null);
      accessRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleScenario(mockUserId, mockPremiumScenario.id),
      ).rejects.toThrow(ForbiddenException);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledWith(mockUserId);
      expect(accessRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUserId, scenarioId: mockPremiumScenario.id },
      });
    });

    it('should throw ForbiddenException when premium scenario, subscription inactive, no grant', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockPremiumScenario);
      subscriptionService.getUserSubscription.mockResolvedValue({ isActive: false });
      accessRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleScenario(mockUserId, mockPremiumScenario.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should fetch scenario with category relation', async () => {
      scenarioRepo.findOne.mockResolvedValue(mockFreeScenario);

      await service.findAccessibleScenario(mockUserId, mockFreeScenario.id);

      expect(scenarioRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockFreeScenario.id, isActive: true, status: 'published' },
        relations: ['category'],
      });
    });
  });
});
