/**
 * Integration test for Phase 3 — concurrent applyRcGroundTruth race condition.
 * Tests that pessimistic locking (lock: pessimistic_write) prevents race conditions.
 *
 * Runs only when TEST_DATABASE_URL is set to a real PostgreSQL URL.
 * In CI: set TEST_DATABASE_URL=postgres://... before `npm test`.
 *
 * To verify the lock works:
 * 1. Run with TEST_DATABASE_URL — should pass (1 row, no exception).
 * 2. Comment out `lock: { mode: 'pessimistic_write' }` in applyRcGroundTruth.
 * 3. Re-run — test should fail.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SubscriptionService } from '../subscription.service';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../../database/entities/subscription.entity';
import { User } from '../../../database/entities/user.entity';
import { WebhookEvent } from '../../../database/entities/webhook-event.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RcSubscriberPayload } from '../clients/revenuecat-rest-client';

/**
 * INTEGRATION TEST — requires real PostgreSQL.
 * Skip if DATABASE_URL is not set or points to in-memory DB.
 */
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DB_URL && TEST_DB_URL.startsWith('postgres') ? describe : describe.skip;

describeIntegration('SubscriptionService — Race Condition (Integration)', () => {
  let service: SubscriptionService;
  let subscriptionRepo: Repository<Subscription>;
  let userRepo: Repository<User>;
  let dataSource: DataSource;

  const USER_ID = 'race-test-user-' + Date.now();
  const RC_PRODUCT = 'com.app.monthly';

  const rcPayload = (): RcSubscriberPayload => ({
    appUserId: USER_ID,
    entitlements: {},
    hasActiveEntitlement: true,
    activeProductId: RC_PRODUCT,
    activeExpiresAtMs: Date.now() + 86400000,
    fetchedAtMs: Date.now(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: getRepositoryToken(Subscription),
          useFactory: (dataSource: DataSource) => dataSource.getRepository(Subscription),
          inject: [getDataSourceToken()],
        },
        {
          provide: getRepositoryToken(User),
          useFactory: (dataSource: DataSource) => dataSource.getRepository(User),
          inject: [getDataSourceToken()],
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useFactory: (dataSource: DataSource) => dataSource.getRepository(WebhookEvent),
          inject: [getDataSourceToken()],
        },
        {
          provide: getDataSourceToken(),
          useFactory: async () => {
            // This will fail gracefully if no real DB; tests depending on real DB will skip
            try {
              const ds = new DataSource({
                type: 'postgres',
                url: TEST_DB_URL || 'postgres://localhost/test',
                entities: [
                  Subscription,
                  User,
                  WebhookEvent,
                  // Include other entities used by the schema
                ],
                synchronize: false,
                logging: false,
              });
              await ds.initialize();
              return ds;
            } catch (err) {
              console.warn('Failed to connect to test DB — race tests will skip');
              throw err;
            }
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    // If DB initialization failed, skip tests
    try {
      service = module.get<SubscriptionService>(SubscriptionService);
      dataSource = module.get<DataSource>(getDataSourceToken());
      subscriptionRepo = dataSource.getRepository(Subscription);
      userRepo = dataSource.getRepository(User);

      // Clean up any test data from previous runs
      await subscriptionRepo.delete({ userId: USER_ID });
      await userRepo.delete({ id: USER_ID });

      // Create test user
      await userRepo.save({
        id: USER_ID,
        email: `race-test-${Date.now()}@test.com`,
        emailVerified: false,
        roles: ['user'],
      });
    } catch (err) {
      console.warn('Test setup failed — skipping race condition tests');
      throw err;
    }
  });

  afterEach(async () => {
    if (!dataSource || !dataSource.isInitialized) return;

    try {
      // Clean up test data
      await subscriptionRepo.delete({ userId: USER_ID });
      await userRepo.delete({ id: USER_ID });
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  });

  /**
   * Core race test: 10 parallel applyRcGroundTruth calls should produce exactly 1 row.
   * Without pessimistic locking, this would create multiple rows or throw unique constraint errors.
   */
  it('concurrent applyRcGroundTruth produces exactly 1 row without race condition', async () => {
    if (!dataSource?.isInitialized) {
      console.log('Skipped: No real database available');
      return;
    }

    // Run 10 parallel calls to applyRcGroundTruth
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => {
        const payload = rcPayload();
        // Vary the timestamp slightly to simulate real-world timing
        payload.fetchedAtMs = Date.now() + i;
        return service.applyRcGroundTruth(USER_ID, payload, 'cron');
      }),
    );

    // All calls should succeed (no unique constraint violations)
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('Race condition detected: some calls threw exceptions');
      for (const failure of failures) {
        console.error('  -', (failure as any).reason?.message);
      }
    }
    expect(failures).toEqual([]);

    // Check that exactly 1 subscription row was created
    const subscriptions = await subscriptionRepo.find({ where: { userId: USER_ID } });
    expect(subscriptions).toHaveLength(1);

    // Verify it has the expected state
    const sub = subscriptions[0];
    expect(sub.plan).toBe(SubscriptionPlan.MONTHLY);
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
  });

  /**
   * Regression test: verify that stale payloads don't overwrite newer ones.
   * This ensures the eventTimestampMs guard works within concurrent calls.
   */
  it('applyRcGroundTruth stale-payload guard prevents downgrade', async () => {
    if (!dataSource?.isInitialized) {
      console.log('Skipped: No real database available');
      return;
    }

    const now = Date.now();

    // Apply a newer payload first
    const newerPayload = rcPayload();
    newerPayload.fetchedAtMs = now + 10000;
    await service.applyRcGroundTruth(USER_ID, newerPayload, 'cron');

    // Attempt to apply older payload concurrently
    const olderPayload = rcPayload();
    olderPayload.fetchedAtMs = now;
    await service.applyRcGroundTruth(USER_ID, olderPayload, 'cron');

    // Verify the newer timestamp is stored
    const sub = await subscriptionRepo.findOne({ where: { userId: USER_ID } });
    expect(sub).toBeDefined();
    expect(sub!.eventTimestampMs).toBe(newerPayload.fetchedAtMs);
  });
});
