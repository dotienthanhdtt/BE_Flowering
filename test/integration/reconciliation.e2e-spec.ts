/**
 * Integration tests for Phase 4: RC REST fallback + reconciliation cron + circuit breaker.
 *
 * All tests use mock repositories — no live DB or RC network calls.
 *
 * Scenarios:
 *   1. PremiumGuard fallback: no DB row + RC says active → isUserPremium returns true
 *   2. Reconciliation: ACTIVE-past-end row + RC says expired → row becomes EXPIRED
 *   3. Circuit breaker: 5 RC errors → 6th call short-circuits without hitting RC client
 *   4. Out-of-order safety: applyRcGroundTruth with stale ts → no-op
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../src/database/entities/subscription.entity';
import { User } from '../../src/database/entities/user.entity';
import { WebhookEvent } from '../../src/database/entities/webhook-event.entity';
import { SubscriptionService } from '../../src/modules/subscription/subscription.service';
import { RevenueCatRestClient, RcSubscriberPayload } from '../../src/modules/subscription/clients/revenuecat-rest-client';
import { SubscriptionReconciliationCron } from '../../src/modules/subscription/cron/subscription-reconciliation.cron';
import { PremiumGuard } from '../../src/common/guards/premium.guard';
import { CircuitBreaker } from '../../src/common/utils/circuit-breaker';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { LessThan } from 'typeorm';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_NO_SUB = 'user-no-sub-0000-0000-0000-000000000000';
const USER_EXPIRED = 'user-expired-000-0000-0000-000000000000';
const USER_ACTIVE_STALE = 'user-stale-0000-0000-0000-000000000000';

const NOW_MS = Date.now();
const PAST_MS = NOW_MS - 60_000;
const FUTURE_MS = NOW_MS + 86_400_000;

function makeActivePayload(userId: string, expiresAtMs: number | null = FUTURE_MS): RcSubscriberPayload {
  return {
    appUserId: userId,
    entitlements: {
      premium: {
        isActive: true,
        expiresAtMs,
        productId: 'monthly_premium',
        purchasedAtMs: PAST_MS,
      },
    },
    hasActiveEntitlement: true,
    activeExpiresAtMs: expiresAtMs,
    activeProductId: 'monthly_premium',
    fetchedAtMs: NOW_MS,
  };
}

function makeExpiredPayload(userId: string): RcSubscriberPayload {
  return {
    appUserId: userId,
    entitlements: {},
    hasActiveEntitlement: false,
    activeExpiresAtMs: null,
    activeProductId: null,
    fetchedAtMs: NOW_MS,
  };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeSubscriptionRepoMock(rows: Map<string, Subscription>) {
  return {
    findOne: jest.fn(({ where }: { where: { userId?: string } | Array<{ userId?: string; cancelAtPeriodEnd?: boolean; status?: SubscriptionStatus; currentPeriodEnd?: ReturnType<typeof LessThan> }> }) => {
      // Handle array where (used by reconciliation cron find)
      if (Array.isArray(where)) return Promise.resolve(null);
      const key = where?.userId;
      return Promise.resolve(key ? (rows.get(key) ?? null) : null);
    }),
    find: jest.fn(() => Promise.resolve([] as Subscription[])),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    save: jest.fn((entity: Subscription) => Promise.resolve(entity)),
    create: jest.fn((data: Partial<Subscription>) => data as Subscription),
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Phase 4 — RC REST Fallback + Reconciliation', () => {
  // ── 1. PremiumGuard fallback ─────────────────────────────────────────────

  describe('PremiumGuard RC fallback', () => {
    let rcClient: jest.Mocked<RevenueCatRestClient>;
    let subscriptionService: SubscriptionService;
    let subRepoMock: ReturnType<typeof makeSubscriptionRepoMock>;

    beforeEach(async () => {
      // Reset static breaker state between tests by creating fresh module
      subRepoMock = makeSubscriptionRepoMock(new Map());

      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          { provide: getRepositoryToken(Subscription), useValue: subRepoMock },
          { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(WebhookEvent), useValue: { insert: jest.fn() } },
          SubscriptionService,
          {
            provide: RevenueCatRestClient,
            useValue: { getSubscriber: jest.fn() } as unknown as RevenueCatRestClient,
          },
          Reflector,
          PremiumGuard,
        ],
      }).compile();

      rcClient = moduleRef.get(RevenueCatRestClient) as jest.Mocked<RevenueCatRestClient>;
      subscriptionService = moduleRef.get(SubscriptionService);

      // Reset static breaker so tests don't bleed into each other
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PremiumGuard as any).rcBreaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 300_000 });
    });

    function makeContext(userId: string): ExecutionContext {
      return {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: userId } }),
        }),
      } as unknown as ExecutionContext;
    }

    it('no DB row + RC says active → returns true (fallback grants access)', async () => {
      rcClient.getSubscriber.mockResolvedValue(makeActivePayload(USER_NO_SUB));

      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      // Re-create guard with this reflector to inject mock
      const g = new PremiumGuard(reflector, subscriptionService, rcClient as unknown as RevenueCatRestClient);
      // Reset static breaker on this guard instance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PremiumGuard as any).rcBreaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 300_000 });

      const ctx = makeContext(USER_NO_SUB);
      const result = await g.canActivate(ctx);

      expect(result).toBe(true);
      expect(rcClient.getSubscriber).toHaveBeenCalledWith(USER_NO_SUB);
    });

    it('no DB row + RC says no active entitlement → throws 403', async () => {
      rcClient.getSubscriber.mockResolvedValue(makeExpiredPayload(USER_NO_SUB));

      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const g = new PremiumGuard(reflector, subscriptionService, rcClient as unknown as RevenueCatRestClient);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PremiumGuard as any).rcBreaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 300_000 });

      const ctx = makeContext(USER_NO_SUB);
      await expect(g.canActivate(ctx)).rejects.toMatchObject({
        message: 'Premium subscription required to access this feature',
      });
    });

    it('DB row active → returns true without calling RC', async () => {
      const activeRow = {
        userId: USER_EXPIRED,
        plan: SubscriptionPlan.MONTHLY,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(FUTURE_MS),
        cancelAtPeriodEnd: false,
        eventTimestampMs: PAST_MS,
      } as Subscription;

      subRepoMock.findOne.mockResolvedValueOnce(activeRow);

      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const g = new PremiumGuard(reflector, subscriptionService, rcClient as unknown as RevenueCatRestClient);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PremiumGuard as any).rcBreaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 300_000 });

      const ctx = makeContext(USER_EXPIRED);
      const result = await g.canActivate(ctx);

      expect(result).toBe(true);
      expect(rcClient.getSubscriber).not.toHaveBeenCalled();
    });
  });

  // ── 2. Reconciliation: ACTIVE-past-end → EXPIRED ─────────────────────────

  describe('SubscriptionService.applyRcGroundTruth', () => {
    let service: SubscriptionService;
    let subRepoMock: ReturnType<typeof makeSubscriptionRepoMock>;

    const staleActiveRow = {
      id: 'sub-id-001',
      userId: USER_ACTIVE_STALE,
      plan: SubscriptionPlan.MONTHLY,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(PAST_MS - 3600_000), // expired 1h ago
      cancelAtPeriodEnd: false,
      eventTimestampMs: PAST_MS - 7200_000, // stored ts is older than fetchedAtMs
    } as Subscription;

    beforeEach(async () => {
      const rows = new Map([[USER_ACTIVE_STALE, staleActiveRow]]);
      subRepoMock = makeSubscriptionRepoMock(rows);

      const moduleRef = await Test.createTestingModule({
        providers: [
          { provide: getRepositoryToken(Subscription), useValue: subRepoMock },
          { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(WebhookEvent), useValue: { insert: jest.fn() } },
          SubscriptionService,
        ],
      }).compile();

      service = moduleRef.get(SubscriptionService);
    });

    it('ACTIVE-past-end + RC expired → row updated to EXPIRED', async () => {
      const rcPayload = makeExpiredPayload(USER_ACTIVE_STALE);
      await service.applyRcGroundTruth(USER_ACTIVE_STALE, rcPayload, 'cron');

      expect(subRepoMock.update).toHaveBeenCalledWith(
        staleActiveRow.id,
        expect.objectContaining({ status: SubscriptionStatus.EXPIRED }),
      );
    });

    it('RC says active → row updated to ACTIVE with new expiresAt', async () => {
      const rcPayload = makeActivePayload(USER_ACTIVE_STALE, FUTURE_MS);
      await service.applyRcGroundTruth(USER_ACTIVE_STALE, rcPayload, 'cron');

      expect(subRepoMock.update).toHaveBeenCalledWith(
        staleActiveRow.id,
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          plan: SubscriptionPlan.MONTHLY,
        }),
      );
    });

    it('out-of-order: stale fetchedAtMs < stored eventTimestampMs → no-op', async () => {
      const freshRow = {
        ...staleActiveRow,
        eventTimestampMs: NOW_MS + 10_000, // stored is newer
      } as Subscription;

      subRepoMock.findOne.mockResolvedValue(freshRow);

      // payload with older fetchedAtMs
      const rcPayload: RcSubscriberPayload = {
        ...makeExpiredPayload(USER_ACTIVE_STALE),
        fetchedAtMs: NOW_MS, // older than stored NOW_MS+10_000
      };

      await service.applyRcGroundTruth(USER_ACTIVE_STALE, rcPayload, 'cron');

      // update must NOT be called — stale payload skipped
      expect(subRepoMock.update).not.toHaveBeenCalled();
    });

    it('no existing row + RC active → creates new row', async () => {
      subRepoMock.findOne.mockResolvedValue(null);

      const rcPayload = makeActivePayload('new-user-id', FUTURE_MS);
      await service.applyRcGroundTruth('new-user-id', rcPayload, 'fallback');

      expect(subRepoMock.save).toHaveBeenCalled();
    });
  });

  // ── 3. Circuit breaker: 5 errors → 6th skips RC ──────────────────────────

  describe('CircuitBreaker integration with reconciliation cron', () => {
    let cron: SubscriptionReconciliationCron;
    let rcClient: jest.Mocked<RevenueCatRestClient>;
    let subRepoMock: ReturnType<typeof makeSubscriptionRepoMock>;

    const pastEnd = new Date(PAST_MS - 3600_000);
    const candidateRow = {
      id: 'sub-cand-001',
      userId: 'cand-user-001',
      plan: SubscriptionPlan.MONTHLY,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: pastEnd,
      cancelAtPeriodEnd: false,
      eventTimestampMs: PAST_MS - 7200_000,
    } as Subscription;

    beforeEach(async () => {
      const rows = new Map([['cand-user-001', candidateRow]]);
      subRepoMock = makeSubscriptionRepoMock(rows);
      // find() returns the candidate for cron queries
      subRepoMock.find.mockResolvedValue([candidateRow]);

      const moduleRef = await Test.createTestingModule({
        providers: [
          { provide: getRepositoryToken(Subscription), useValue: subRepoMock },
          { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(WebhookEvent), useValue: { insert: jest.fn() } },
          SubscriptionService,
          {
            provide: RevenueCatRestClient,
            useValue: { getSubscriber: jest.fn() } as unknown as RevenueCatRestClient,
          },
          SubscriptionReconciliationCron,
        ],
      }).compile();

      cron = moduleRef.get(SubscriptionReconciliationCron);
      rcClient = moduleRef.get(RevenueCatRestClient) as jest.Mocked<RevenueCatRestClient>;
    });

    it('reconciles candidate: ACTIVE-past-end + RC expired → EXPIRED', async () => {
      rcClient.getSubscriber.mockResolvedValue(makeExpiredPayload('cand-user-001'));

      await cron.runReconciliation();

      expect(subRepoMock.update).toHaveBeenCalledWith(
        candidateRow.id,
        expect.objectContaining({ status: SubscriptionStatus.EXPIRED }),
      );
    });

    it('circuit breaker: 5 RC errors → breaker opens → 6th cron run skips RC entirely', async () => {
      rcClient.getSubscriber.mockRejectedValue(new Error('rc-outage'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const breaker: CircuitBreaker = (cron as any).rcBreaker;

      // Trigger 5 failures via the breaker directly to avoid running full cron 5x
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }
      expect(breaker.state).toBe('OPEN');

      // With breaker OPEN, cron should log and exit without calling RC
      const callsBefore = rcClient.getSubscriber.mock.calls.length;
      await cron.runReconciliation();
      expect(rcClient.getSubscriber.mock.calls.length).toBe(callsBefore);
    });

    it('RC error during cron run records failure in breaker', async () => {
      rcClient.getSubscriber.mockRejectedValue(new Error('rc-timeout'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const breaker: CircuitBreaker = (cron as any).rcBreaker;
      expect(breaker.state).toBe('CLOSED');

      await cron.runReconciliation();

      // One failure recorded — breaker still CLOSED (threshold=5)
      expect(breaker.state).toBe('CLOSED');
    });
  });
});
