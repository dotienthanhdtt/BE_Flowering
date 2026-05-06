import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResourceAccessGuard } from './resource-access.guard';
import { AccessTierCacheService } from '../services/access-tier-cache.service';
import { SubscriptionService } from '../../modules/subscription/subscription.service';
import { AccessTier } from '../../database/entities/access-tier.enum';

describe('ResourceAccessGuard', () => {
  let guard: ResourceAccessGuard;
  let reflector: jest.Mocked<Reflector>;
  let tierCache: jest.Mocked<AccessTierCacheService>;
  let subscriptionService: jest.Mocked<SubscriptionService>;

  const RESOURCE_ID = 'scenario-1';
  const USER_ID = 'user-1';

  const buildContext = (
    opts: {
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
      user?: { id: string };
    } = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          params: opts.params ?? {},
          body: opts.body ?? {},
          user: opts.user,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceAccessGuard,
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: AccessTierCacheService, useValue: { get: jest.fn() } },
        { provide: SubscriptionService, useValue: { isUserPremium: jest.fn() } },
      ],
    }).compile();

    guard = module.get(ResourceAccessGuard);
    reflector = module.get(Reflector);
    tierCache = module.get(AccessTierCacheService);
    subscriptionService = module.get(SubscriptionService);
  });

  it('allows when no @RequireResourceAccess metadata is present', async () => {
    reflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(tierCache.get).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when resource id is missing', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    await expect(guard.canActivate(buildContext())).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when tier lookup returns null', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    tierCache.get.mockResolvedValue(null);
    await expect(
      guard.canActivate(buildContext({ params: { id: RESOURCE_ID } })),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows free-tier resources without checking subscription', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    tierCache.get.mockResolvedValue(AccessTier.FREE);
    await expect(
      guard.canActivate(buildContext({ params: { id: RESOURCE_ID } })),
    ).resolves.toBe(true);
    expect(subscriptionService.isUserPremium).not.toHaveBeenCalled();
  });

  it('allows premium resource for premium user', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    tierCache.get.mockResolvedValue(AccessTier.PREMIUM);
    subscriptionService.isUserPremium.mockResolvedValue(true);
    await expect(
      guard.canActivate(
        buildContext({ params: { id: RESOURCE_ID }, user: { id: USER_ID } }),
      ),
    ).resolves.toBe(true);
    expect(subscriptionService.isUserPremium).toHaveBeenCalledWith(USER_ID);
  });

  it('rejects premium resource for free user with 403', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    tierCache.get.mockResolvedValue(AccessTier.PREMIUM);
    subscriptionService.isUserPremium.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        buildContext({ params: { id: RESOURCE_ID }, user: { id: USER_ID } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects premium resource without authenticated user with 403', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', paramKey: 'id' });
    tierCache.get.mockResolvedValue(AccessTier.PREMIUM);
    await expect(
      guard.canActivate(buildContext({ params: { id: RESOURCE_ID } })),
    ).rejects.toThrow(ForbiddenException);
    expect(subscriptionService.isUserPremium).not.toHaveBeenCalled();
  });

  it('reads resource id from request body when bodyKey is configured', async () => {
    reflector.get.mockReturnValue({ resource: 'scenario', bodyKey: 'scenarioId' });
    tierCache.get.mockResolvedValue(AccessTier.FREE);
    await expect(
      guard.canActivate(buildContext({ body: { scenarioId: RESOURCE_ID } })),
    ).resolves.toBe(true);
    expect(tierCache.get).toHaveBeenCalledWith('scenario', RESOURCE_ID);
  });
});
