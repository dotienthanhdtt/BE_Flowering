/**
 * E2E test for RevenueCat webhook (Phase 1 hardening).
 * Boots a NestJS Test module containing only the webhook controller + a stub
 * SubscriptionService, mounts the global ValidationPipe + interceptors, and
 * fires real HTTP requests via supertest to assert auth/replay/validation/
 * outcome propagation behavior.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { ResponseTransformInterceptor, AllExceptionsFilter } from '../src/common';
import { RevenuecatWebhookController } from '../src/modules/subscription/webhooks/revenuecat-webhook.controller';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';

const SECRET = 'test-secret-abc-123';

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  api_version: '1.0',
  event: {
    id: `evt-${Date.now()}-${Math.random()}`,
    type: 'RENEWAL',
    app_user_id: 'user-1',
    product_id: 'com.app.monthly',
    event_timestamp_ms: Date.now(),
    ...overrides,
  },
});

describe('POST /webhooks/revenuecat (E2E)', () => {
  let app: INestApplication;
  let processWebhookMock: jest.Mock;

  beforeAll(async () => {
    processWebhookMock = jest.fn().mockResolvedValue({ outcome: 'processed' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        // Loose throttle so the test won't trip auth-failure throttling on each request
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10000 }]),
      ],
      controllers: [RevenuecatWebhookController],
      providers: [
        {
          provide: SubscriptionService,
          useValue: { processWebhook: (...args: unknown[]) => processWebhookMock(...args) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'revenuecat.webhookSecret' ? SECRET : undefined,
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    processWebhookMock.mockClear();
    processWebhookMock.mockResolvedValue({ outcome: 'processed' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .send(validEvent());
      expect(res.status).toBe(401);
      expect(processWebhookMock).not.toHaveBeenCalled();
    });

    it('returns 401 on wrong secret', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', 'Bearer wrong-secret-of-same-length-x')
        .send(validEvent());
      expect(res.status).toBe(401);
      expect(processWebhookMock).not.toHaveBeenCalled();
    });

    it('accepts "Bearer <secret>" format', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(validEvent());
      expect(res.status).toBe(200);
      expect(processWebhookMock).toHaveBeenCalledTimes(1);
    });

    it('accepts bare "<secret>" format', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', SECRET)
        .send(validEvent());
      expect(res.status).toBe(200);
      expect(processWebhookMock).toHaveBeenCalledTimes(1);
    });

    it('accepts case-insensitive "bearer" prefix', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `bearer ${SECRET}`)
        .send(validEvent());
      expect(res.status).toBe(200);
    });
  });

  describe('replay window', () => {
    it('drops events older than 24h with outcome=stale_dropped, no service call', async () => {
      const stale = validEvent({ event_timestamp_ms: Date.now() - 25 * 3600 * 1000 });
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(stale);
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('stale_dropped');
      expect(processWebhookMock).not.toHaveBeenCalled();
    });

    it('accepts events within 24h', async () => {
      const fresh = validEvent({ event_timestamp_ms: Date.now() - 1 * 3600 * 1000 });
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(fresh);
      expect(res.status).toBe(200);
      expect(processWebhookMock).toHaveBeenCalledTimes(1);
    });

    it('accepts events with no event_timestamp_ms', async () => {
      const payload = validEvent();
      delete (payload.event as { event_timestamp_ms?: number }).event_timestamp_ms;
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(payload);
      expect(res.status).toBe(200);
      expect(processWebhookMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('payload validation (@ValidateNested)', () => {
    it('rejects missing event with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ api_version: '1.0' });
      expect(res.status).toBe(400);
      expect(processWebhookMock).not.toHaveBeenCalled();
    });

    it('rejects event with missing required id', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ api_version: '1.0', event: { type: 'RENEWAL' } });
      expect(res.status).toBe(400);
      expect(processWebhookMock).not.toHaveBeenCalled();
    });

    it('rejects event with invalid environment value', async () => {
      const bad = validEvent({ environment: 'BADENV' });
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(bad);
      expect(res.status).toBe(400);
      expect(processWebhookMock).not.toHaveBeenCalled();
    });
  });

  describe('outcome propagation', () => {
    it('returns service outcome=processed in response body', async () => {
      processWebhookMock.mockResolvedValueOnce({ outcome: 'processed' });
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(validEvent());
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('processed');
      expect(res.body.data.status).toBe('received');
    });

    it('returns outcome=duplicate when service detects idempotency', async () => {
      processWebhookMock.mockResolvedValueOnce({ outcome: 'duplicate' });
      const res = await request(app.getHttpServer())
        .post('/webhooks/revenuecat')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(validEvent());
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('duplicate');
    });
  });
});
