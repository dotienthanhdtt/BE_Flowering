import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionService } from '../subscription.service';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../../database/entities/subscription.entity';
import { User } from '../../../database/entities/user.entity';
import { WebhookEvent } from '../../../database/entities/webhook-event.entity';
import { RcSubscriberPayload, RevenueCatRestClient } from '../clients/revenuecat-rest-client';
import { PendingClaimsService } from '../pending-claims.service';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let dataSource: jest.Mocked<DataSource>;

  const USER_ID = '00000000-0000-4000-8000-000000000123';
  const EVENT_ID = 'evt-123';

  const mockSubscription = (): Subscription => ({
    id: 'sub-1',
    userId: USER_ID,
    plan: SubscriptionPlan.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    appUserId: 'rc-user-1',
    autoResumeAt: null,
    currentPeriodStart: new Date('2024-01-01'),
    currentPeriodEnd: new Date('2024-02-01'),
    cancelAtPeriodEnd: false,
    eventTimestampMs: 100000,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: undefined as any,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: {
            insert: jest.fn(),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: PendingClaimsService,
          useValue: {
            recordPending: jest.fn().mockResolvedValue(undefined),
            claimVerifiedFor: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RevenueCatRestClient,
          useValue: {
            getSubscriber: jest.fn().mockResolvedValue({
              hasActiveEntitlement: false,
              activeProductId: null,
              activeExpiresAtMs: null,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    dataSource = module.get(getDataSourceToken());
  });

  // ─── Phase 2: REFUND Handler Tests ──────────────────────────────────────

  describe('REFUND handler', () => {
    it('should set status=EXPIRED and currentPeriodEnd=now on REFUND', async () => {
      const existing = mockSubscription();
      const eventTimestamp = 200000;

      // Create a mock manager with proper insert support
      const updateCalls: any[] = [];
      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(existing),
              update: jest.fn().mockImplementation(async (id, patch) => {
                updateCalls.push({ id, patch });
                return { affected: 1 };
              }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'REFUND',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          event_timestamp_ms: eventTimestamp,
        },
      };

      await service.processWebhook(payload as any);

      // Verify EXPIRED status was set
      expect(updateCalls.length).toBeGreaterThan(0);
      const refundCall = updateCalls.find((c) =>
        c.patch.status === SubscriptionStatus.EXPIRED,
      );
      expect(refundCall).toBeDefined();
      expect(refundCall.patch.currentPeriodEnd).toBeDefined();
    });
  });

  // ─── Phase 5: Unknown Product Mapping Tests ────────────────────────────

  describe('mapProductToPlan', () => {
    it('should return UNKNOWN plan (not throw) on unknown product ID, capped at 7d', async () => {
      const createCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation((data) => {
                createCalls.push(data);
                return { ...data, id: 'sub-unknown' };
              }),
              save: jest.fn().mockResolvedValue({ id: 'sub-unknown' }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const now = Date.now();
      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'RENEWAL',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          product_id: 'unknown_sku_12345',
          event_timestamp_ms: now,
          expiration_at_ms: now + 365 * 24 * 3600 * 1000, // 1yr — should be capped
        },
      };

      await expect(service.processWebhook(payload as any)).resolves.not.toThrow();

      expect(createCalls.length).toBeGreaterThan(0);
      const created = createCalls[0];
      expect(created.plan).toBe(SubscriptionPlan.UNKNOWN);
      // Must be capped at ≤ 7 days from now
      const maxEnd = now + 7 * 24 * 3600 * 1000;
      expect(created.currentPeriodEnd.getTime()).toBeLessThanOrEqual(maxEnd + 1000);
    });

    it('should map monthly products to MONTHLY plan', async () => {
      const saveCalls: any[] = [];
      const mockSub = mockSubscription();

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue(mockSub),
              save: jest.fn().mockImplementation(async (s) => {
                saveCalls.push(s);
                return s;
              }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'RENEWAL',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      expect(saveCalls.length).toBeGreaterThan(0);
      const saved = saveCalls[0];
      expect(saved.plan).toBe(SubscriptionPlan.MONTHLY);
    });

    it('should map yearly/annual products to YEARLY plan', async () => {
      const createCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation((data) => {
                createCalls.push(data);
                return { ...data, id: 'sub-new' } as Subscription;
              }),
              save: jest.fn().mockResolvedValue({ id: 'sub-new' } as Subscription),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'RENEWAL',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          product_id: 'yearly_subscription_ios',
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      expect(createCalls.length).toBeGreaterThan(0);
      const created = createCalls[0];
      expect(created.plan).toBe(SubscriptionPlan.YEARLY);
    });

    it('should map lifetime products to LIFETIME plan', async () => {
      const createCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation((data) => {
                createCalls.push(data);
                return { ...data, id: 'sub-new' } as Subscription;
              }),
              save: jest.fn().mockResolvedValue({ id: 'sub-new' } as Subscription),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'RENEWAL',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          product_id: 'lifetime_access',
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      expect(createCalls.length).toBeGreaterThan(0);
      const created = createCalls[0];
      expect(created.plan).toBe(SubscriptionPlan.LIFETIME);
    });
  });

  // ─── Phase 5: EXPIRATION Sets Plan=FREE Tests ──────────────────────────

  describe('EXPIRATION handler', () => {
    it('should set status=EXPIRED and plan=FREE on EXPIRATION', async () => {
      const existing = mockSubscription();
      const updateCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(existing),
              update: jest.fn().mockImplementation(async (id, patch) => {
                updateCalls.push({ id, patch });
                return { affected: 1 };
              }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'EXPIRATION',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          expiration_reason: 'UNSUBSCRIBE',
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      const expCall = updateCalls.find(
        (c) =>
          c.patch.status === SubscriptionStatus.EXPIRED &&
          c.patch.plan === SubscriptionPlan.FREE,
      );
      expect(expCall).toBeDefined();
    });
  });

  // ─── Phase 5: autoResumeAt Persistence Tests ────────────────────────────

  describe('SUBSCRIPTION_PAUSED handler', () => {
    it('should persist autoResumeAt when provided', async () => {
      const existing = mockSubscription();
      const resumeAtMs = Date.now() + 86400000;
      const updateCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(existing),
              update: jest.fn().mockImplementation(async (id, patch) => {
                updateCalls.push({ id, patch });
                return { affected: 1 };
              }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'SUBSCRIPTION_PAUSED',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          auto_resume_at_ms: resumeAtMs,
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      const pauseCall = updateCalls.find(
        (c) =>
          c.patch.status === SubscriptionStatus.PAUSED && c.patch.autoResumeAt,
      );
      expect(pauseCall).toBeDefined();
      expect(pauseCall.patch.autoResumeAt).toBeDefined();
    });

    it('should set autoResumeAt=null when not provided', async () => {
      const existing = mockSubscription();
      const updateCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(existing),
              update: jest.fn().mockImplementation(async (id, patch) => {
                updateCalls.push({ id, patch });
                return { affected: 1 };
              }),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockResolvedValue({ id: USER_ID }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      const payload = {
        api_version: '1.0',
        event: {
          id: EVENT_ID,
          type: 'SUBSCRIPTION_PAUSED',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      const pauseCall = updateCalls.find(
        (c) => c.patch.status === SubscriptionStatus.PAUSED,
      );
      expect(pauseCall).toBeDefined();
      expect(pauseCall.patch.autoResumeAt).toBeNull();
    });
  });

  // ─── Phase 2: Cron Expansion Tests (applyRcGroundTruth) ──────────────────

  describe('applyRcGroundTruth (cron expansion)', () => {
    it('should apply RC ground truth when user has active entitlement', async () => {
      const rcPayload: RcSubscriberPayload = {
        appUserId: USER_ID,
        entitlements: {},
        hasActiveEntitlement: true,
        activeProductId: 'com.app.yearly',
        activeExpiresAtMs: Date.now() + 86400000,
        fetchedAtMs: Date.now(),
      };

      const existing = mockSubscription();
      existing.status = SubscriptionStatus.EXPIRED;

      const updateCalls: any[] = [];

      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async (entity, id, patch) => {
          updateCalls.push({ entity, id, patch });
          return { affected: 1 };
        }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      await service.applyRcGroundTruth(USER_ID, rcPayload, 'cron');

      const yearlyCall = updateCalls.find(
        (c) =>
          c.patch.plan === SubscriptionPlan.YEARLY &&
          c.patch.status === SubscriptionStatus.ACTIVE,
      );
      expect(yearlyCall).toBeDefined();
    });

    it('resolves user via app_user_id when aliases also contain a different valid UUID', async () => {
      const primaryId = '11111111-1111-4111-8111-111111111111';
      const aliasId = '22222222-2222-4222-8222-222222222222';
      const findOneCalls: string[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockImplementation(async ({ where }: any) => {
                findOneCalls.push(where.id);
                if (where.id === primaryId) return { id: primaryId };
                return null;
              }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-precedence',
          type: 'RENEWAL',
          app_user_id: primaryId,
          original_app_user_id: '$RCAnonymousID:abc',
          aliases: [aliasId],
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);

      expect(findOneCalls[0]).toBe(primaryId);
      expect(findOneCalls).not.toContain(aliasId);
    });

    it('falls back to original_app_user_id when app_user_id is anonymous', async () => {
      const originalId = '33333333-3333-4333-8333-333333333333';
      const findOneCalls: string[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockImplementation(async ({ where }: any) => {
                findOneCalls.push(where.id);
                if (where.id === originalId) return { id: originalId };
                return null;
              }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-original',
          type: 'RENEWAL',
          app_user_id: '$RCAnonymousID:abc',
          original_app_user_id: originalId,
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);

      expect(findOneCalls).toEqual([originalId]);
    });

    it('emits warning when aliases[] fallback resolves the user', async () => {
      const aliasId = '44444444-4444-4444-8444-444444444444';
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockImplementation(async ({ where }: any) =>
                where.id === aliasId ? { id: aliasId } : null,
              ),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-alias',
          type: 'RENEWAL',
          app_user_id: '55555555-5555-4555-8555-555555555555', // unknown UUID
          original_app_user_id: '$RCAnonymousID:abc',
          aliases: [aliasId],
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);

      expect(
        warnSpy.mock.calls.some(([msg]) =>
          typeof msg === 'string' && msg.includes('resolveUser_via_aliases'),
        ),
      ).toBe(true);

      warnSpy.mockRestore();
    });

    it('returns null user when all candidates are anonymous', async () => {
      const userFindOne = jest.fn().mockResolvedValue(null);

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          if (entity === User) return { findOne: userFindOne };
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-all-anon',
          type: 'RENEWAL',
          app_user_id: '$RCAnonymousID:a',
          original_app_user_id: '$RCAnonymousID:b',
          aliases: ['$RCAnonymousID:c'],
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);

      expect(userFindOne).not.toHaveBeenCalled();
    });

    it('skips non-UUID app_user_id and falls through to next branch', async () => {
      const originalId = '66666666-6666-4666-8666-666666666666';
      const findOneCalls: string[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          if (entity === User) {
            return {
              findOne: jest.fn().mockImplementation(async ({ where }: any) => {
                findOneCalls.push(where.id);
                return where.id === originalId ? { id: originalId } : null;
              }),
            };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-nonuuid',
          type: 'RENEWAL',
          app_user_id: 'not-a-uuid',
          original_app_user_id: originalId,
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);

      expect(findOneCalls).toEqual([originalId]);
    });
  });

  // ─── Drift logging ───────────────────────────────────────────────────────

  describe('subscription_user_drift logging', () => {
    const buildManager = (existing: Subscription | null) => ({
      getRepository: jest.fn((entity) => {
        if (entity === Subscription) {
          return {
            findOne: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
          };
        }
        if (entity === User) {
          return { findOne: jest.fn().mockResolvedValue({ id: USER_ID }) };
        }
        return {};
      }),
      insert: jest.fn().mockResolvedValue({ identifiers: [] }),
    });

    const runWebhook = async (eventAppUserId: string) => {
      await service.processWebhook({
        api_version: '1.0',
        event: {
          id: 'evt-drift',
          type: 'RENEWAL',
          app_user_id: eventAppUserId,
          original_app_user_id: USER_ID,
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      } as any);
    };

    it('emits warning when event app_user_id differs from stored row', async () => {
      const existing = mockSubscription();
      existing.appUserId = 'stored-rc-id-xyz';
      const mockManager = buildManager(existing);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await runWebhook(USER_ID);

      expect(
        warnSpy.mock.calls.some(([msg]) =>
          typeof msg === 'string' && msg.includes('subscription_user_drift'),
        ),
      ).toBe(true);

      warnSpy.mockRestore();
    });

    it('does not emit drift warning when ids match', async () => {
      const existing = mockSubscription();
      existing.appUserId = USER_ID;
      const mockManager = buildManager(existing);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await runWebhook(USER_ID);

      expect(
        warnSpy.mock.calls.some(([msg]) =>
          typeof msg === 'string' && msg.includes('subscription_user_drift'),
        ),
      ).toBe(false);

      warnSpy.mockRestore();
    });

    it('does not emit drift warning on first-time row creation (existing null)', async () => {
      const mockManager = buildManager(null);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await runWebhook(USER_ID);

      expect(
        warnSpy.mock.calls.some(([msg]) =>
          typeof msg === 'string' && msg.includes('subscription_user_drift'),
        ),
      ).toBe(false);

      warnSpy.mockRestore();
    });
  });

  // ─── C2: Unknown SKU (T9, T10) ────────────────────────────────────────

  describe('C2 — Unknown SKU', () => {
    it('T9: RENEWAL with unknown SKU + far-future expiry → plan=UNKNOWN, currentPeriodEnd capped at 7d', async () => {
      const createCalls: any[] = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation((data) => {
                createCalls.push(data);
                return { ...data, id: 'sub-unknown-t9' };
              }),
              save: jest.fn().mockImplementation(async (s) => s),
            };
          }
          if (entity === User) {
            return { findOne: jest.fn().mockResolvedValue({ id: USER_ID }) };
          }
          return {};
        }),
        insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const now = Date.now();
      const oneYearMs = 365 * 24 * 3600 * 1000;

      const payload = {
        api_version: '1.0',
        event: {
          id: 'evt-t9',
          type: 'RENEWAL',
          app_user_id: USER_ID,
          original_app_user_id: USER_ID,
          product_id: 'flowering_unknown_xyz',
          event_timestamp_ms: now,
          expiration_at_ms: now + oneYearMs, // 1yr — must be capped
        },
      };

      await service.processWebhook(payload as any);

      expect(createCalls.length).toBeGreaterThan(0);
      const created = createCalls[0];
      expect(created.plan).toBe(SubscriptionPlan.UNKNOWN);
      // Hard cap: currentPeriodEnd must be within 7 days + 1s tolerance
      const maxEnd = now + 7 * 24 * 3600 * 1000;
      expect(created.currentPeriodEnd.getTime()).toBeLessThanOrEqual(maxEnd + 1000);
      // Sanity: NOT allowed to remain at 1yr
      expect(created.currentPeriodEnd.getTime()).toBeLessThan(now + oneYearMs);
    });

    it('T10: UNKNOWN plan + null currentPeriodEnd → isSubscriptionActive=false', () => {
      const subscription: Subscription = {
        id: 'sub-nrp',
        userId: USER_ID,
        plan: SubscriptionPlan.UNKNOWN,
        status: SubscriptionStatus.ACTIVE,
        appUserId: USER_ID,
        autoResumeAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: null as any, // null expiry on UNKNOWN → must be inactive
        cancelAtPeriodEnd: false,
        eventTimestampMs: Date.now(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: undefined as any,
      };

      const isActive = service.isSubscriptionActive(subscription);
      expect(isActive).toBe(false);
    });
  });

  // ─── C3: Fallback date-aware expire (T11) ─────────────────────────────

  describe('C3 — Fallback date-aware expire', () => {
    const buildManagerForApplyRc = () => {
      const updateCalls: any[] = [];
      const mockManager = {
        findOne: jest.fn(),
        update: jest.fn().mockImplementation(async (_entity, _id, patch) => {
          updateCalls.push(patch);
          return { affected: 1 };
        }),
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
      };
      return { mockManager, updateCalls };
    };

    it('T11a: fallback + currentPeriodEnd > now → no EXPIRED write', async () => {
      const future = new Date(Date.now() + 86400000); // tomorrow
      const existing: Subscription = {
        ...mockSubscription(),
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: future,
        eventTimestampMs: 0,
      };

      const { mockManager, updateCalls } = buildManagerForApplyRc();
      mockManager.findOne.mockResolvedValue(existing);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const rcPayload: RcSubscriberPayload = {
        appUserId: USER_ID,
        entitlements: {},
        hasActiveEntitlement: false,
        activeProductId: null,
        activeExpiresAtMs: null,
        fetchedAtMs: Date.now() + 1, // newer than stored ts=0
      };

      await service.applyRcGroundTruth(USER_ID, rcPayload, 'fallback');

      const expireWrite = updateCalls.find(
        (p: any) => p.status === SubscriptionStatus.EXPIRED,
      );
      expect(expireWrite).toBeUndefined();
    });

    it('T11b: fallback + currentPeriodEnd < now → EXPIRED written', async () => {
      const past = new Date(Date.now() - 86400000); // yesterday
      const existing: Subscription = {
        ...mockSubscription(),
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: past,
        eventTimestampMs: 0,
      };

      const { mockManager, updateCalls } = buildManagerForApplyRc();
      mockManager.findOne.mockResolvedValue(existing);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const rcPayload: RcSubscriberPayload = {
        appUserId: USER_ID,
        entitlements: {},
        hasActiveEntitlement: false,
        activeProductId: null,
        activeExpiresAtMs: null,
        fetchedAtMs: Date.now() + 1,
      };

      await service.applyRcGroundTruth(USER_ID, rcPayload, 'fallback');

      const expireWrite = updateCalls.find(
        (p: any) => p.status === SubscriptionStatus.EXPIRED,
      );
      expect(expireWrite).toBeDefined();
    });

    it('T11c: cron + currentPeriodEnd > now → EXPIRED written (cron always expires)', async () => {
      const future = new Date(Date.now() + 86400000); // tomorrow
      const existing: Subscription = {
        ...mockSubscription(),
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: future,
        eventTimestampMs: 0,
      };

      const { mockManager, updateCalls } = buildManagerForApplyRc();
      mockManager.findOne.mockResolvedValue(existing);
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      const rcPayload: RcSubscriberPayload = {
        appUserId: USER_ID,
        entitlements: {},
        hasActiveEntitlement: false,
        activeProductId: null,
        activeExpiresAtMs: null,
        fetchedAtMs: Date.now() + 1,
      };

      await service.applyRcGroundTruth(USER_ID, rcPayload, 'cron');

      const expireWrite = updateCalls.find(
        (p: any) => p.status === SubscriptionStatus.EXPIRED,
      );
      expect(expireWrite).toBeDefined();
    });
  });

  // ─── T14: WebhookEvent idempotency + pending claim in same TX ─────────

  describe('T14 — Anonymous webhook: idempotency row + pending claim', () => {
    it('T14: anonymous purchase → WebhookEvent insert AND recordPending called once; replayHandlers does NOT re-insert WebhookEvent', async () => {
      const insertCalls: Array<{ entity: any }> = [];

      const mockManager = {
        getRepository: jest.fn((entity) => {
          if (entity === User) {
            // All IDs are anonymous — no user found
            return { findOne: jest.fn().mockResolvedValue(null) };
          }
          if (entity === Subscription) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            };
          }
          return {};
        }),
        insert: jest.fn().mockImplementation(async (entity: any) => {
          insertCalls.push({ entity });
          return { identifiers: [] };
        }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockManager as unknown as EntityManager),
      );

      // Track recordPending calls
      const pendingClaimsService = (service as any).pendingClaims as jest.Mocked<PendingClaimsService>;

      const payload = {
        api_version: '1.0',
        event: {
          id: 'evt-anon-t14',
          type: 'INITIAL_PURCHASE',
          app_user_id: '$RCAnonymousID:anon-abc',
          original_app_user_id: '$RCAnonymousID:anon-abc',
          product_id: 'com.app.monthly',
          event_timestamp_ms: Date.now(),
        },
      };

      await service.processWebhook(payload as any);

      // WebhookEvent idempotency row MUST be inserted first (manager.insert called with WebhookEvent)
      expect(insertCalls.length).toBeGreaterThanOrEqual(1);
      expect(insertCalls[0].entity).toBe(WebhookEvent);

      // recordPending MUST be called exactly once for anonymous purchase event
      expect(pendingClaimsService.recordPending).toHaveBeenCalledTimes(1);

      // replayHandlers does NOT insert a second WebhookEvent row
      const webhookEventInserts = insertCalls.filter((c) => c.entity === WebhookEvent);
      expect(webhookEventInserts.length).toBe(1);
    });
  });

  // ─── applyRcGroundTruth (cron) — kept original case below ─────────────
  describe('applyRcGroundTruth (negative case)', () => {
    it('should expire subscription when RC has no active entitlement', async () => {
      const rcPayload: RcSubscriberPayload = {
        appUserId: USER_ID,
        entitlements: {},
        hasActiveEntitlement: false,
        activeProductId: null,
        activeExpiresAtMs: null,
        fetchedAtMs: Date.now(),
      };

      const existing = mockSubscription();

      const updateCalls: any[] = [];

      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async (entity, id, patch) => {
          updateCalls.push({ entity, id, patch });
          return { affected: 1 };
        }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockManager as unknown as EntityManager);
      });

      await service.applyRcGroundTruth(USER_ID, rcPayload, 'cron');

      const expireCall = updateCalls.find(
        (c) => c.patch.status === SubscriptionStatus.EXPIRED,
      );
      expect(expireCall).toBeDefined();
    });
  });
});
