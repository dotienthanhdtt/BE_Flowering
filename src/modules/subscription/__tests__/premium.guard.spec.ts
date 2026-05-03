import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PremiumGuard } from '../../../common/guards/premium.guard';
import { SubscriptionService } from '../subscription.service';
import { RevenueCatRestClient } from '../clients/revenuecat-rest-client';
import { SubscriptionDto } from '../dto/subscription.dto';
import { SubscriptionPlan, SubscriptionStatus } from '../../../database/entities/subscription.entity';

describe('PremiumGuard', () => {
  let guard: PremiumGuard;
  let subscriptionService: jest.Mocked<SubscriptionService>;
  let rcClient: jest.Mocked<RevenueCatRestClient>;
  let reflector: jest.Mocked<Reflector>;

  const USER_ID = 'user-123';

  const createMockContext = () => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: USER_ID,
            email: 'test@example.com',
          },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  const mockActiveSubscription = (): SubscriptionDto => ({
    id: 'sub-1',
    plan: SubscriptionPlan.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 86400000), // tomorrow
    isActive: true,
    cancelAtPeriodEnd: false,
    autoResumeAt: null,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PremiumGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: SubscriptionService,
          useValue: {
            getUserSubscription: jest.fn(),
            applyRcGroundTruth: jest.fn(),
          },
        },
        {
          provide: RevenueCatRestClient,
          useValue: {
            getSubscriber: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PremiumGuard>(PremiumGuard);
    reflector = module.get(Reflector);
    subscriptionService = module.get(SubscriptionService);
    rcClient = module.get(RevenueCatRestClient);
  });

  describe('canActivate', () => {
    it('should return true when @RequirePremium is not set', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      const context = createMockContext();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException when no user is authenticated', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: undefined,
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user has no active subscription', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(null);
      (rcClient.getSubscriber as jest.Mock).mockResolvedValue(null);

      const context = createMockContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Phase 4: Cache Hit Tests ──────────────────────────────────────────

  describe('Cache behavior', () => {
    it('should return true from cache without hitting DB on second call within 60s', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(
        mockActiveSubscription(),
      );

      const context = createMockContext();

      // First call — hits DB
      const result1 = await guard.canActivate(context);
      expect(result1).toBe(true);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledTimes(1);

      // Second call within 60s — should hit cache
      const result2 = await guard.canActivate(context);
      expect(result2).toBe(true);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledTimes(1); // no additional call
    });

    it('should bypass cache and re-read DB on third call after 60s timeout', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(
        mockActiveSubscription(),
      );

      const context = createMockContext();

      // First call — hits DB, caches
      await guard.canActivate(context);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledTimes(1);

      // Simulate cache expiration by accessing private cache directly
      // and setting expiresAt to the past
      const cacheEntry = (guard as any).cache.get(USER_ID);
      if (cacheEntry) {
        cacheEntry.expiresAt = Date.now() - 1000; // expired
      }

      // Call again — should hit DB again since cache expired
      await guard.canActivate(context);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Phase 4: Event-Driven Cache Eviction Tests ────────────────────────

  describe('subscription.changed event handling', () => {
    it('should evict cache entry when subscription.changed event is emitted', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(
        mockActiveSubscription(),
      );

      const context = createMockContext();

      // First call — caches
      await guard.canActivate(context);
      expect((guard as any).cache.has(USER_ID)).toBe(true);

      // Emit subscription.changed event
      guard.handleSubscriptionChanged({ userId: USER_ID });

      // Cache should be evicted
      expect((guard as any).cache.has(USER_ID)).toBe(false);

      // Next call should hit DB again
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(subscriptionService.getUserSubscription).toHaveBeenCalledTimes(2);
    });

    it('should only evict the specific user cache, not all entries', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(
        mockActiveSubscription(),
      );

      const user2Id = 'user-456';

      // Manually populate cache for two users
      (guard as any).cache.set(USER_ID, { expiresAt: Date.now() + 60000 });
      (guard as any).cache.set(user2Id, { expiresAt: Date.now() + 60000 });

      expect((guard as any).cache.size).toBe(2);

      // Evict only user1
      guard.handleSubscriptionChanged({ userId: USER_ID });

      // Only user1 should be evicted
      expect((guard as any).cache.has(USER_ID)).toBe(false);
      expect((guard as any).cache.has(user2Id)).toBe(true);
      expect((guard as any).cache.size).toBe(1);
    });
  });

  describe('RC fallback path', () => {
    it('should call RC getSubscriber when DB has no active subscription', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
      (subscriptionService.getUserSubscription as jest.Mock).mockResolvedValue(null);
      (rcClient.getSubscriber as jest.Mock).mockResolvedValue({
        hasActiveEntitlement: true,
        activeProductId: 'com.app.monthly',
        activeExpiresAtMs: Date.now() + 86400000,
        fetchedAtMs: Date.now(),
      });
      (subscriptionService.applyRcGroundTruth as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(rcClient.getSubscriber).toHaveBeenCalledWith(USER_ID);
    });
  });
});
