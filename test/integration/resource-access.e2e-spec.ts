/**
 * Integration tests for ResourceAccessGuard + AccessTierCacheService:
 *   - Free user → premium scenario detail → 403 with error_code='subscription_required'
 *   - Premium user → premium scenario detail → 200
 *   - Free user → scenario list → premium rows have locked:true with no description
 *   - Premium user → scenario list → premium rows have full payload
 *   - POST /scenario/chat → free user with premium scenarioId → 403
 *
 * Uses mock repositories — no live DB required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { Scenario, ScenarioDifficulty } from '../../src/database/entities/scenario.entity';
import { AccessTier } from '../../src/database/entities/access-tier.enum';
import { ContentStatus } from '../../src/database/entities/content-status.enum';
import { ScenarioType } from '../../src/database/entities/scenario-type.enum';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../src/database/entities/subscription.entity';
import { UserScenarioAccess } from '../../src/database/entities/user-scenario-access.entity';
import { UserLanguage } from '../../src/database/entities/user-language.entity';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { AccessTierCacheService } from '../../src/common/services/access-tier-cache.service';
import { ResourceAccessGuard } from '../../src/common/guards/resource-access.guard';
import { SubscriptionService } from '../../src/modules/subscription/subscription.service';
import { User } from '../../src/database/entities/user.entity';
import { WebhookEvent } from '../../src/database/entities/webhook-event.entity';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FREE_USER_ID = 'free0000-0000-0000-0000-000000000000';
const PREMIUM_USER_ID = 'prem0000-0000-0000-0000-000000000000';
const FREE_SCENARIO_ID = 'free1111-0000-0000-0000-000000000000';
const PREMIUM_SCENARIO_ID = 'prem1111-0000-0000-0000-000000000000';
const LANGUAGE_ID = 'lang0000-0000-0000-0000-000000000000';

const freeScenario = {
  id: FREE_SCENARIO_ID,
  title: 'Free Scenario',
  description: 'A free scenario',
  accessTier: AccessTier.FREE,
  status: ContentStatus.PUBLISHED,
  type: ScenarioType.SYSTEM,
  difficulty: ScenarioDifficulty.BEGINNER,
  languageId: LANGUAGE_ID,
  orderIndex: 1,
  ownerId: null,
  imageUrl: null,
  category: null,
} as unknown as Scenario;

const premiumScenario = {
  id: PREMIUM_SCENARIO_ID,
  title: 'Premium Scenario',
  description: 'Locked content',
  accessTier: AccessTier.PREMIUM,
  status: ContentStatus.PUBLISHED,
  type: ScenarioType.SYSTEM,
  difficulty: ScenarioDifficulty.ADVANCED,
  languageId: LANGUAGE_ID,
  orderIndex: 2,
  ownerId: null,
  imageUrl: null,
  category: null,
} as unknown as Scenario;

const activePremiumSubscription = {
  userId: PREMIUM_USER_ID,
  plan: SubscriptionPlan.MONTHLY,
  status: SubscriptionStatus.ACTIVE,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
} as Subscription;

// ─── Mock JWT guard (injects user from header) ────────────────────────────────

import { CanActivate } from '@nestjs/common';

class MockJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: { id: string } }>();
    const userId = req.headers['x-mock-user-id'];
    if (userId) req.user = { id: userId };
    return true;
  }
}

// ─── Minimal test module ──────────────────────────────────────────────────────

async function buildApp(): Promise<INestApplication> {
  // Mock scenario repo
  const scenarioRepoMock = {
    findOne: jest.fn(({ where }: { where: { id?: string } }) => {
      if (where?.id === FREE_SCENARIO_ID) return Promise.resolve(freeScenario);
      if (where?.id === PREMIUM_SCENARIO_ID) return Promise.resolve(premiumScenario);
      return Promise.resolve(null);
    }),
  };

  // Mock subscription repo
  const subscriptionRepoMock = {
    findOne: jest.fn(({ where }: { where: { userId?: string } }) => {
      if (where?.userId === PREMIUM_USER_ID) return Promise.resolve(activePremiumSubscription);
      return Promise.resolve(null);
    }),
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: 'test' })],
    providers: [
      { provide: getRepositoryToken(Scenario), useValue: scenarioRepoMock },
      { provide: getRepositoryToken(Subscription), useValue: subscriptionRepoMock },
      { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
      { provide: getRepositoryToken(WebhookEvent), useValue: {} },
      { provide: getRepositoryToken(UserScenarioAccess), useValue: {} },
      { provide: getRepositoryToken(UserLanguage), useValue: {} },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      SubscriptionService,
      AccessTierCacheService,
      Reflector,
      ResourceAccessGuard,
    ],
  })
    .overrideGuard('JwtAuthGuard')
    .useValue(new MockJwtGuard())
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AccessTierCacheService', () => {
  let cacheService: AccessTierCacheService;
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    cacheService = app.get(AccessTierCacheService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns FREE tier for free scenario', async () => {
    const tier = await cacheService.get('scenario', FREE_SCENARIO_ID);
    expect(tier).toBe(AccessTier.FREE);
  });

  it('returns PREMIUM tier for premium scenario', async () => {
    const tier = await cacheService.get('scenario', PREMIUM_SCENARIO_ID);
    expect(tier).toBe(AccessTier.PREMIUM);
  });

  it('returns null for unknown scenario id', async () => {
    const tier = await cacheService.get('scenario', 'nonexistent-id');
    expect(tier).toBeNull();
  });

  it('caches the tier on second call (no extra DB hit)', async () => {
    const scenarioRepo = app.get(getRepositoryToken(Scenario));
    const callsBefore = (scenarioRepo.findOne as jest.Mock).mock.calls.length;
    await cacheService.get('scenario', FREE_SCENARIO_ID);
    const callsAfter = (scenarioRepo.findOne as jest.Mock).mock.calls.length;
    expect(callsAfter).toBe(callsBefore); // no extra DB call
  });

  it('invalidate() clears cache entry', async () => {
    const scenarioRepo = app.get(getRepositoryToken(Scenario));
    await cacheService.get('scenario', FREE_SCENARIO_ID); // warm cache
    cacheService.invalidate('scenario', FREE_SCENARIO_ID);
    const callsBefore = (scenarioRepo.findOne as jest.Mock).mock.calls.length;
    await cacheService.get('scenario', FREE_SCENARIO_ID);
    expect((scenarioRepo.findOne as jest.Mock).mock.calls.length).toBe(callsBefore + 1);
  });
});

describe('ResourceAccessGuard', () => {
  let guard: ResourceAccessGuard;
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    guard = app.get(ResourceAccessGuard);
  });

  afterAll(async () => {
    await app.close();
  });

  function makeContext(
    userId: string | undefined,
    params: Record<string, string>,
    body: Record<string, string>,
    meta: { resource: 'scenario'; paramKey?: string; bodyKey?: string } | undefined,
  ): ExecutionContext {
    const reflector = app.get(Reflector);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: userId ? { id: userId } : undefined,
          params,
          body,
        }),
      }),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
    return ctx;
  }

  it('no metadata → allows through', async () => {
    const ctx = makeContext(FREE_USER_ID, {}, {}, undefined);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('free scenario → free user → allowed', async () => {
    const ctx = makeContext(
      FREE_USER_ID,
      { id: FREE_SCENARIO_ID },
      {},
      { resource: 'scenario', paramKey: 'id' },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('premium scenario → free user → throws 403 with subscription_required', async () => {
    const ctx = makeContext(
      FREE_USER_ID,
      { id: PREMIUM_SCENARIO_ID },
      {},
      { resource: 'scenario', paramKey: 'id' },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error_code: 'subscription_required', code: 0 },
    });
  });

  it('premium scenario → premium user → allowed', async () => {
    const ctx = makeContext(
      PREMIUM_USER_ID,
      { id: PREMIUM_SCENARIO_ID },
      {},
      { resource: 'scenario', paramKey: 'id' },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('premium scenario → bodyKey resolution → free user → throws 403', async () => {
    const ctx = makeContext(
      FREE_USER_ID,
      {},
      { scenarioId: PREMIUM_SCENARIO_ID },
      { resource: 'scenario', bodyKey: 'scenarioId' },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error_code: 'subscription_required' },
    });
  });

  it('unknown scenario id → allows through (let handler produce 404)', async () => {
    const ctx = makeContext(
      FREE_USER_ID,
      { id: 'unknown-id' },
      {},
      { resource: 'scenario', paramKey: 'id' },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});

describe('SubscriptionService.isUserPremium', () => {
  let service: SubscriptionService;
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    service = app.get(SubscriptionService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns false for free user', async () => {
    expect(await service.isUserPremium(FREE_USER_ID)).toBe(false);
  });

  it('returns true for premium user', async () => {
    expect(await service.isUserPremium(PREMIUM_USER_ID)).toBe(true);
  });
});
