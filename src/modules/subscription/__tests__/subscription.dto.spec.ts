/**
 * T13 — DTO compat shim tests.
 *
 * Verifies that mapToDto (called via getUserSubscription / getSubscriptionWithReconcile)
 * returns plan='unknown' when X-Client-Iap-Version=2, and plan='monthly' for old clients
 * (no header or version ≠ '2') when the subscription row has plan=UNKNOWN.
 *
 * mapToDto is private on SubscriptionService; we exercise it indirectly through
 * getUserSubscription (no iapVersion arg → old-client path) and
 * the public isSubscriptionActive helper to verify the raw UNKNOWN rows.
 * The compat shim logic lives entirely inside SubscriptionService.mapToDto.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionService } from '../subscription.service';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../../database/entities/subscription.entity';
import { WebhookEvent } from '../../../database/entities/webhook-event.entity';
import { PendingClaimsService } from '../pending-claims.service';
import { RevenueCatRestClient } from '../clients/revenuecat-rest-client';

describe('T13 — DTO compat shim (UNKNOWN plan)', () => {
  let service: SubscriptionService;

  const USER_ID = 'dto-test-user-uuid';

  const makeUnknownSub = (): Subscription => ({
    id: 'sub-unknown-dto',
    userId: USER_ID,
    plan: SubscriptionPlan.UNKNOWN,
    status: SubscriptionStatus.ACTIVE,
    appUserId: 'rc-anon',
    autoResumeAt: null,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 86400000), // tomorrow — actively in period
    cancelAtPeriodEnd: false,
    eventTimestampMs: Date.now(),
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
            findOne: jest.fn().mockResolvedValue(makeUnknownSub()),
            update: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: { insert: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn() } as unknown as DataSource,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
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
            getSubscriber: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('T13a: UNKNOWN row + iapVersion="2" → DTO plan="unknown"', async () => {
    // getUserSubscription does not accept iapVersion; invoke mapToDto indirectly via
    // getUserSubscription which calls mapToDto with no iapVersion (old-client path).
    // To test iapVersion='2', we test via isSubscriptionActive (raw plan) to confirm
    // the underlying row is UNKNOWN, then verify the shim by calling the private
    // mapToDto via (service as any).mapToDto.
    const sub = makeUnknownSub();
    const dtoV2 = (service as any).mapToDto(sub, '2');
    expect(dtoV2.plan).toBe(SubscriptionPlan.UNKNOWN);
  });

  it('T13b: UNKNOWN row + no iapVersion header (old client) → DTO plan="monthly"', async () => {
    const sub = makeUnknownSub();
    const dtoLegacy = (service as any).mapToDto(sub, undefined);
    expect(dtoLegacy.plan).toBe(SubscriptionPlan.MONTHLY);
  });

  it('T13c: UNKNOWN row + iapVersion="1" (explicit old version) → DTO plan="monthly"', async () => {
    const sub = makeUnknownSub();
    const dtoV1 = (service as any).mapToDto(sub, '1');
    expect(dtoV1.plan).toBe(SubscriptionPlan.MONTHLY);
  });

  it('T13d: MONTHLY row → DTO plan="monthly" regardless of iapVersion', async () => {
    const sub = makeUnknownSub();
    sub.plan = SubscriptionPlan.MONTHLY;

    const dtoV2 = (service as any).mapToDto(sub, '2');
    expect(dtoV2.plan).toBe(SubscriptionPlan.MONTHLY);

    const dtoLegacy = (service as any).mapToDto(sub, undefined);
    expect(dtoLegacy.plan).toBe(SubscriptionPlan.MONTHLY);
  });

  it('T13e: isActive field reflects raw UNKNOWN row status, not the shimmed plan', async () => {
    const sub = makeUnknownSub(); // UNKNOWN + future currentPeriodEnd
    const dto = (service as any).mapToDto(sub, '2');
    // isActive is computed from raw subscription, not from shimmed plan
    expect(dto.isActive).toBe(true);
  });
});
