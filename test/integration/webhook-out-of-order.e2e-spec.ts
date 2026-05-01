/**
 * Integration tests for RevenueCat webhook hardening:
 *   - Out-of-order event guard (eventTimestampMs comparison)
 *   - REFUND handler
 *   - CANCELLATION reason-aware branching
 *   - TRANSFER relinks userId
 *
 * Uses mock repositories — no live DB required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as (app: any) => any;
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SubscriptionModule } from '../../src/modules/subscription/subscription.module';
import { Subscription, SubscriptionStatus, SubscriptionPlan } from '../../src/database/entities/subscription.entity';
import { User } from '../../src/database/entities/user.entity';
import { WebhookEvent } from '../../src/database/entities/webhook-event.entity';
import { ResponseTransformInterceptor } from '../../src/common/interceptors/response-transform.interceptor';

// ─── Test fixtures ──────────────────────────────────────────────────────────
const USER_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WEBHOOK_SECRET = 'test-secret';

const userA: Partial<User> = { id: USER_A_ID, email: 'a@test.com' } as User;
const userB: Partial<User> = { id: USER_B_ID, email: 'b@test.com' } as User;

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type: 'RENEWAL',
    app_user_id: USER_A_ID,
    original_app_user_id: USER_A_ID,
    product_id: 'com.app.monthly',
    environment: 'SANDBOX',
    event_timestamp_ms: 100,
    ...overrides,
  };
}

function webhookBody(event: Record<string, unknown>) {
  return { api_version: '1.0', event };
}

// ─── Repo factories ──────────────────────────────────────────────────────────
interface SubRepoMock {
  _sub: Subscription | null;
  findOne: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  insert: jest.Mock;
}

function makeSubRepo(storedSub: Partial<Subscription> | null = null): SubRepoMock {
  const initial: Subscription | null = storedSub
    ? ({ id: 'sub-1', userId: USER_A_ID, plan: SubscriptionPlan.MONTHLY,
        status: SubscriptionStatus.ACTIVE, eventTimestampMs: null,
        cancelAtPeriodEnd: false, ...storedSub } as Subscription)
    : null;

  const repo: SubRepoMock = {
    _sub: initial,
    findOne: jest.fn(async (): Promise<Subscription | null> => repo._sub),
    update: jest.fn(async (_where: unknown, patch: Partial<Subscription>): Promise<void> => {
      if (repo._sub) Object.assign(repo._sub, patch);
    }),
    create: jest.fn((data: Partial<Subscription>): Subscription => ({ ...data } as Subscription)),
    save: jest.fn(async (s: Subscription): Promise<Subscription> => { repo._sub = s; return s; }),
    insert: jest.fn(),
  };
  return repo;
}

function makeUserRepo(users: Partial<User>[] = [userA, userB]) {
  return {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      users.find((u) => u.id === where.id) ?? null,
    ),
  };
}

let eventInsertFails = false;
function makeWebhookEventRepo() {
  return {
    insert: jest.fn(async () => {
      if (eventInsertFails) {
        const err = new Error('duplicate') as Error & { code: string };
        err.code = '23505';
        throw err;
      }
    }),
  };
}

// ─── App bootstrap helper ────────────────────────────────────────────────────
async function buildApp(
  subRepo: ReturnType<typeof makeSubRepo>,
  userRepo: ReturnType<typeof makeUserRepo>,
  webhookRepo: ReturnType<typeof makeWebhookEventRepo>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      SubscriptionModule,
    ],
  })
    .overrideProvider(getRepositoryToken(Subscription))
    .useValue(subRepo)
    .overrideProvider(getRepositoryToken(User))
    .useValue(userRepo)
    .overrideProvider(getRepositoryToken(WebhookEvent))
    .useValue(webhookRepo)
    .overrideProvider(ConfigService)
    .useValue({
      get: (_key: string, _opts?: unknown) => WEBHOOK_SECRET,
    })
    .compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new ResponseTransformInterceptor());
  await app.init();
  return app;
}

function authHeader() {
  return { Authorization: `Bearer ${WEBHOOK_SECRET}` };
}

// ─── Test suites ─────────────────────────────────────────────────────────────
describe('Webhook hardening — out-of-order guard', () => {
  let app: INestApplication;
  let subRepo: ReturnType<typeof makeSubRepo>;

  beforeAll(async () => {
    eventInsertFails = false;
    // Subscription already has eventTimestampMs=100 (from a RENEWAL processed earlier)
    subRepo = makeSubRepo({ eventTimestampMs: 100, status: SubscriptionStatus.ACTIVE });
    app = await buildApp(subRepo, makeUserRepo(), makeWebhookEventRepo());
  });
  afterAll(() => app.close());

  it('stale EXPIRATION (ts=50) after RENEWAL (ts=100) → user stays ACTIVE', async () => {
    const body = webhookBody(baseEvent({ type: 'EXPIRATION', event_timestamp_ms: 50 }));

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    // update() must NOT have been called — stale event skipped
    expect(subRepo.update).not.toHaveBeenCalled();
    expect(subRepo._sub?.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('newer EXPIRATION (ts=200) after RENEWAL (ts=100) → user becomes EXPIRED', async () => {
    // Reset mock state
    subRepo.update.mockClear();
    const body = webhookBody(baseEvent({ type: 'EXPIRATION', event_timestamp_ms: 200 }));

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subRepo.update).toHaveBeenCalled();
    expect(subRepo._sub?.status).toBe(SubscriptionStatus.EXPIRED);
  });
});

describe('Webhook hardening — REFUND', () => {
  let app: INestApplication;
  let subRepo: ReturnType<typeof makeSubRepo>;

  beforeAll(async () => {
    eventInsertFails = false;
    subRepo = makeSubRepo({ status: SubscriptionStatus.ACTIVE, eventTimestampMs: 10 });
    app = await buildApp(subRepo, makeUserRepo(), makeWebhookEventRepo());
  });
  afterAll(() => app.close());

  it('REFUND event → status=EXPIRED immediately', async () => {
    const body = webhookBody(baseEvent({ type: 'REFUND', event_timestamp_ms: 20 }));

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subRepo._sub?.status).toBe(SubscriptionStatus.EXPIRED);
    expect(subRepo._sub?.cancelAtPeriodEnd).toBe(false);
  });
});

describe('Webhook hardening — CANCELLATION reason branching', () => {
  let appUnsubscribe: INestApplication;
  let appSupport: INestApplication;
  let subForUnsubscribe: ReturnType<typeof makeSubRepo>;
  let subForSupport: ReturnType<typeof makeSubRepo>;

  beforeAll(async () => {
    eventInsertFails = false;
    subForUnsubscribe = makeSubRepo({ status: SubscriptionStatus.ACTIVE });
    appUnsubscribe = await buildApp(subForUnsubscribe, makeUserRepo(), makeWebhookEventRepo());

    subForSupport = makeSubRepo({ status: SubscriptionStatus.ACTIVE });
    appSupport = await buildApp(subForSupport, makeUserRepo(), makeWebhookEventRepo());
  });
  afterAll(() => Promise.all([appUnsubscribe.close(), appSupport.close()]));

  it('CANCELLATION cancel_reason=UNSUBSCRIBE → cancelAtPeriodEnd=true, status=ACTIVE', async () => {
    const body = webhookBody(
      baseEvent({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: 50 }),
    );

    const res = await request(appUnsubscribe.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subForUnsubscribe._sub?.cancelAtPeriodEnd).toBe(true);
    expect(subForUnsubscribe._sub?.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('CANCELLATION cancel_reason=CUSTOMER_SUPPORT → status=EXPIRED immediately', async () => {
    const body = webhookBody(
      baseEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: 50 }),
    );

    const res = await request(appSupport.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subForSupport._sub?.status).toBe(SubscriptionStatus.EXPIRED);
    expect(subForSupport._sub?.cancelAtPeriodEnd).toBe(false);
  });
});

describe('Webhook hardening — TRANSFER', () => {
  let app: INestApplication;
  let subRepo: ReturnType<typeof makeSubRepo>;

  beforeAll(async () => {
    eventInsertFails = false;
    // Subscription currently belongs to USER_A
    subRepo = makeSubRepo({ userId: USER_A_ID, status: SubscriptionStatus.ACTIVE });
    app = await buildApp(subRepo, makeUserRepo(), makeWebhookEventRepo());
  });
  afterAll(() => app.close());

  it('TRANSFER → subscription row userId moves from USER_A to USER_B', async () => {
    const body = webhookBody(
      baseEvent({
        type: 'TRANSFER',
        app_user_id: USER_A_ID,
        transferred_from: USER_A_ID,
        transferred_to: USER_B_ID,
        event_timestamp_ms: 60,
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subRepo.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({ userId: USER_B_ID }),
    );
  });

  it('TRANSFER with missing transferred_to → skipped, no update', async () => {
    subRepo.update.mockClear();
    const body = webhookBody(
      baseEvent({ type: 'TRANSFER', transferred_from: USER_A_ID, event_timestamp_ms: 70 }),
    );

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subRepo.update).not.toHaveBeenCalled();
  });
});

describe('Webhook hardening — idempotency still works', () => {
  let app: INestApplication;
  let subRepo: ReturnType<typeof makeSubRepo>;

  beforeAll(async () => {
    subRepo = makeSubRepo({ status: SubscriptionStatus.ACTIVE });
    app = await buildApp(subRepo, makeUserRepo(), makeWebhookEventRepo());
  });
  afterAll(() => app.close());

  it('duplicate event ID → skipped (23505 duplicate key)', async () => {
    eventInsertFails = true;
    const body = webhookBody(baseEvent({ type: 'EXPIRATION', event_timestamp_ms: 999 }));

    const res = await request(app.getHttpServer())
      .post('/webhooks/revenuecat')
      .set(authHeader())
      .send(body);

    expect(res.status).toBe(200);
    expect(subRepo.update).not.toHaveBeenCalled();
    eventInsertFails = false;
  });
});
