import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '@/database/entities/user.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { PersonalizationQuotaService } from './personalization-quota.service';
import { SubscriptionPlan } from '@/database/entities/subscription.entity';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockScenarioRepo = () => ({
  count: jest.fn(),
});

const mockSubscriptionService = () => ({
  getUserSubscription: jest.fn(),
});

describe('PersonalizationQuotaService', () => {
  let service: PersonalizationQuotaService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let scenarioRepo: ReturnType<typeof mockScenarioRepo>;
  let subscriptionService: ReturnType<typeof mockSubscriptionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizationQuotaService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(Scenario), useFactory: mockScenarioRepo },
        { provide: SubscriptionService, useFactory: mockSubscriptionService },
      ],
    }).compile();

    service = module.get(PersonalizationQuotaService);
    userRepo = module.get(getRepositoryToken(User));
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    subscriptionService = module.get(SubscriptionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('checkQuota', () => {
    describe('free tier (no active subscription)', () => {
      it('should return free_blocked when subscription is null', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue(null);

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'free_blocked' });
      });

      it('should return free_blocked when subscription is inactive', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: false,
          plan: SubscriptionPlan.MONTHLY,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'free_blocked' });
      });
    });

    describe('daily ceiling (3 scenarios/24h)', () => {
      it('should return daily_ceiling when user has 3+ scenarios in last 24h', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(3);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: null,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'daily_ceiling' });
      });

      it('should return daily_ceiling when user has 5+ scenarios in last 24h', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(5);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: null,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'daily_ceiling' });
      });

      it('should pass daily_ceiling when user has <3 scenarios in last 24h', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(2);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: null,
        });

        const result = await service.checkQuota('user-1');

        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('ok');
      });
    });

    describe('LIFETIME plan (unlimited after daily ceiling)', () => {
      it('should return daily_ceiling when LIFETIME plan user exceeds 3/day', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.LIFETIME,
        });
        scenarioRepo.count.mockResolvedValue(10); // Exceeds daily ceiling

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'daily_ceiling' });
      });

      it('should return ok (allowed=true) for LIFETIME plan when under daily ceiling', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.LIFETIME,
        });
        scenarioRepo.count.mockResolvedValue(1); // Under daily ceiling

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: true, reason: 'ok' });
      });
    });

    describe('PREMIUM monthly (1 trial/month)', () => {
      it('should return ok with quotaRemaining=1 when trial not used this month', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(0);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: null,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: true, reason: 'ok', quotaRemaining: 1 });
      });

      it('should return paywall when trial already used this month', async () => {
        const now = new Date();
        const thisMonthDate = new Date(now.getUTCFullYear(), now.getUTCMonth(), 15);

        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(0);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: thisMonthDate,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'paywall' });
      });

      it('should return ok when trial was used in previous month', async () => {
        const now = new Date();
        const lastMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 15);

        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(0);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: lastMonth,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: true, reason: 'ok', quotaRemaining: 1 });
      });

      it('should allow ok when trial used last year in different month', async () => {
        const now = new Date();
        const lastYear = new Date(now.getUTCFullYear() - 1, now.getUTCMonth(), 15);

        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(0);
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: lastYear,
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: true, reason: 'ok', quotaRemaining: 1 });
      });
    });

    describe('daily ceiling takes precedence over paywall', () => {
      it('should return daily_ceiling even if premium trial not used', async () => {
        subscriptionService.getUserSubscription.mockResolvedValue({
          isActive: true,
          plan: SubscriptionPlan.MONTHLY,
        });
        scenarioRepo.count.mockResolvedValue(3); // At ceiling
        userRepo.findOne.mockResolvedValue({
          personalizedTrialUsedAt: null, // Trial available
        });

        const result = await service.checkQuota('user-1');

        expect(result).toEqual({ allowed: false, reason: 'daily_ceiling' });
      });
    });
  });

  describe('markPremiumTrialUsed', () => {
    it('should update user with current timestamp', async () => {
      const userId = 'user-1';
      userRepo.update.mockResolvedValue({});

      await service.markPremiumTrialUsed(userId);

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        personalizedTrialUsedAt: expect.any(Date),
      });
    });
  });
});
