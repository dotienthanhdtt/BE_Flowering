import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { WebhookEvent } from '../../database/entities/webhook-event.entity';
import {
  RevenueCatWebhookDto,
  RevenueCatEventDto,
  RevenueCatCancelReason,
} from './dto/revenuecat-webhook.dto';
import { SubscriptionDto } from './dto/subscription.dto';
import { RcSubscriberPayload } from './clients/revenuecat-rest-client';

/** Cancel reasons that trigger immediate revocation (not period-end). */
const IMMEDIATE_REVOKE_REASONS: RevenueCatCancelReason[] = ['CUSTOMER_SUPPORT', 'BILLING_ERROR'];

/** RC events that should be silently acknowledged — we don't act on them yet. */
const SILENT_ACK_EVENTS = new Set<string>([
  'TEST',
  'INVOICE_ISSUANCE',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'EXPERIMENT_ENROLLMENT',
]);

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Service handling subscription operations and RevenueCat webhook processing.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private emitChanged(userId: string): void {
    this.eventEmitter.emit('subscription.changed', { userId });
  }

  /**
   * Get user's current subscription.
   */
  async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription) return null;
    return this.mapToDto(subscription);
  }

  /**
   * Process a RevenueCat webhook event.
   *
   * Guards (in order): sandbox-in-prod filter → silent-ack short-circuit →
   * transactional dispatch (idempotency lock + handler in one atomic unit).
   *
   * If the handler throws, the transaction rolls back including the
   * idempotency row, so RevenueCat's retry will reprocess the event.
   */
  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    const { event } = payload;

    if (process.env.NODE_ENV === 'production' && event.environment === 'SANDBOX') {
      this.logger.warn(
        `Ignoring SANDBOX event ${event.id} (type: ${event.type}) received in production`,
      );
      return;
    }

    if (SILENT_ACK_EVENTS.has(event.type)) {
      this.logger.debug(`Silently acknowledging RC event ${event.type} id=${event.id}`);
      // Still record it for idempotency — outside a transaction is fine since handler is a no-op.
      await this.recordIdempotency(event);
      return;
    }

    const touchedIds = await this.dataSource.transaction(async (manager) => {
      // Idempotency lock — insert first; on duplicate-key, we've seen this event before.
      try {
        await manager.insert(WebhookEvent, { eventId: event.id, eventType: event.type });
      } catch (error: unknown) {
        if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          this.logger.debug(`Event ${event.id} already processed, skipping`);
          return [];
        }
        throw error;
      }

      return this.dispatch(event, manager);
    });
    // Emit after transaction commits so guard re-reads committed state
    for (const id of touchedIds ?? []) {
      this.emitChanged(id);
    }
  }

  /** Insert idempotency row, swallow duplicate-key errors. Used outside transactions. */
  private async recordIdempotency(event: RevenueCatEventDto): Promise<void> {
    try {
      await this.webhookEventRepo.insert({ eventId: event.id, eventType: event.type });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) return;
      throw error;
    }
  }

  /** Resolve event to user, apply out-of-order guard, route to handler. Returns mutated userIds. */
  private async dispatch(event: RevenueCatEventDto, manager: EntityManager): Promise<string[]> {
    const subscriptionRepo = manager.getRepository(Subscription);
    const userRepo = manager.getRepository(User);

    // TRANSFER has its own user-resolution path; delegate before standard user lookup.
    if (event.type === 'TRANSFER') {
      return this.handleTransfer(event, subscriptionRepo, userRepo);
    }

    const user = await this.resolveUser(event, userRepo);
    if (!user) {
      this.logger.warn(
        `User not found for RC event ${event.id} (app_user_id=${event.app_user_id ?? 'null'})`,
      );
      return [];
    }

    // Single locked read — result reused by stale guard and handlers to avoid double round-trip.
    const existing = await subscriptionRepo.findOne({
      where: { userId: user.id },
      lock: { mode: 'pessimistic_write' },
    });

    if (this.isStaleEvent(event, existing)) {
      this.logger.warn(
        `Stale event ${event.id} ts=${event.event_timestamp_ms} — skipping`,
      );
      return [];
    }

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'NON_RENEWING_PURCHASE':
      case 'TEMPORARY_ENTITLEMENT_GRANT':
      case 'REFUND_REVERSED':
        await this.handlePurchaseOrRenewal(user.id, event, subscriptionRepo, existing);
        break;
      case 'PRODUCT_CHANGE':
        await this.handleProductChange(user.id, event, subscriptionRepo, existing);
        break;
      case 'SUBSCRIPTION_EXTENDED':
        await this.handleExtension(user.id, event, subscriptionRepo);
        break;
      case 'REFUND':
        await this.handleRefund(user.id, event, subscriptionRepo, existing);
        break;
      case 'CANCELLATION':
        await this.handleCancellation(user.id, event, subscriptionRepo);
        break;
      case 'EXPIRATION':
        await this.handleExpiration(user.id, event, subscriptionRepo);
        break;
      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user.id, event, subscriptionRepo);
        return []; // no premium-access state changed — skip cache eviction
      case 'SUBSCRIPTION_PAUSED':
        await this.handlePaused(user.id, event, subscriptionRepo);
        break;
      default:
        this.logger.warn(`Unhandled RC event type: ${event.type}`);
        return [];
    }
    return [user.id];
  }

  /**
   * Resolve a User row from any of the IDs RC may send:
   *   app_user_id → original_app_user_id → aliases[]
   * RC keeps the anonymous ID as `original_app_user_id` even after logIn(),
   * so falling back through these is required to catch logged-in subscribers
   * whose first transaction was anonymous.
   */
  private async resolveUser(
    event: RevenueCatEventDto,
    userRepo: Repository<User>,
  ): Promise<User | null> {
    const candidates = [
      event.app_user_id,
      event.original_app_user_id,
      ...(event.aliases ?? []),
    ].filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && !id.startsWith('$RCAnonymousID:'),
    );

    for (const id of candidates) {
      const user = await userRepo.findOne({ where: { id } });
      if (user) return user;
    }
    return null;
  }

  private isStaleEvent(event: RevenueCatEventDto, existing: Subscription | null): boolean {
    const incomingTs = event.event_timestamp_ms ?? null;
    if (incomingTs === null || !existing || existing.eventTimestampMs === null) return false;
    return incomingTs <= existing.eventTimestampMs;
  }

  // ---------------------------------------------------------------------------
  // Private handlers — all take the transactional Subscription repo
  // ---------------------------------------------------------------------------

  private async handlePurchaseOrRenewal(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    if (!event.product_id) {
      this.logger.warn(`Event ${event.id} (${event.type}) missing product_id — skipping`);
      return;
    }
    const plan = this.mapProductToPlan(event.product_id);
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
    const purchaseDate = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();

    const tsField = { eventTimestampMs: event.event_timestamp_ms ?? null };

    if (existing) {
      await subscriptionRepo.update(existing.id, {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        cancelAtPeriodEnd: false,
        revenuecatId: event.original_app_user_id,
        ...tsField,
      });
    } else {
      const sub = subscriptionRepo.create({
        userId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        revenuecatId: event.original_app_user_id,
        ...tsField,
      });
      await subscriptionRepo.save(sub);
    }

    this.logger.log(`Subscription activated for user ${userId}: ${plan} (event=${event.type})`);
  }

  /** PRODUCT_CHANGE — switch plan to new_product_id (or product_id) and refresh expiry. */
  private async handleProductChange(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    const productId = event.new_product_id ?? event.product_id;
    if (!productId) {
      this.logger.warn(`PRODUCT_CHANGE event ${event.id} missing product info — skipping`);
      return;
    }
    await this.handlePurchaseOrRenewal(
      userId,
      { ...event, product_id: productId },
      subscriptionRepo,
      existing,
    );
  }

  /** SUBSCRIPTION_EXTENDED — push currentPeriodEnd forward; do NOT change plan or status. */
  private async handleExtension(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    if (!event.expiration_at_ms) {
      this.logger.warn(`SUBSCRIPTION_EXTENDED ${event.id} missing expiration_at_ms — skipping`);
      return;
    }
    const result = await subscriptionRepo.update(
      { userId },
      {
        currentPeriodEnd: new Date(event.expiration_at_ms),
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    if (!result.affected || result.affected === 0) {
      this.logger.warn(
        `handleExtension: no subscription found for user ${userId} — 0 rows updated (event=${event.id}, expiration_at_ms=${event.expiration_at_ms})`,
      );
    } else {
      this.logger.log(`Subscription extended for user ${userId} until ${event.expiration_at_ms}`);
    }
  }

  /** REFUND — immediately revoke premium access. Idempotent: repeated calls leave status=EXPIRED. */
  private async handleRefund(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    if (!existing) {
      this.logger.warn(`REFUND event ${event.id}: no subscription found for user ${userId} — skipping`);
      return;
    }
    const incomingTs = event.event_timestamp_ms ?? null;
    // Preserve the existing guard when the event has no timestamp — avoids nulling out
    // the out-of-order guard, which would let a subsequent stale RENEWAL slip through.
    const effectiveTs =
      existing.eventTimestampMs !== null && incomingTs === null
        ? existing.eventTimestampMs
        : incomingTs;

    await subscriptionRepo.update(existing.id, {
      status: SubscriptionStatus.EXPIRED,
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      eventTimestampMs: effectiveTs,
    });
    this.logger.log(`Subscription refunded (immediately revoked) for user ${userId}`);

    // Warn when CANCELLATION with support/billing reason is the actual refund channel
    // so we can audit whether RC emits REFUND directly or routes through CANCELLATION.
  }

  /**
   * CANCELLATION — differentiate by cancel_reason:
   *   UNSUBSCRIBE / DEVELOPER_INITIATED / PRICE_INCREASE / UNKNOWN → period-end
   *     (keep ACTIVE, set cancelAtPeriodEnd=true).
   *   CUSTOMER_SUPPORT / BILLING_ERROR → immediate revoke (refunds and support pulls).
   */
  private async handleCancellation(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    const reason = event.cancel_reason as RevenueCatCancelReason | undefined;
    const isImmediateRevoke = reason !== undefined && IMMEDIATE_REVOKE_REASONS.includes(reason);

    if (isImmediateRevoke) {
      await subscriptionRepo.update(
        { userId },
        {
          status: SubscriptionStatus.EXPIRED,
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
          eventTimestampMs: event.event_timestamp_ms ?? null,
        },
      );
      this.logger.log(
        `Subscription immediately revoked (cancel_reason=${reason}) for user ${userId}`,
      );
    } else {
      await subscriptionRepo.update(
        { userId },
        {
          cancelAtPeriodEnd: true,
          eventTimestampMs: event.event_timestamp_ms ?? null,
        },
      );
      this.logger.log(
        `Subscription will cancel at period end (cancel_reason=${reason ?? 'UNSUBSCRIBE'}) for user ${userId}`,
      );
    }
  }

  private async handleExpiration(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    await subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    this.logger.log(
      `Subscription expired for user ${userId} (reason=${event.expiration_reason ?? 'UNKNOWN'})`,
    );
  }

  /**
   * BILLING_ISSUE — RC is retrying the charge. The subscription is NOT expired yet;
   * if a grace period is in effect, the user keeps premium access until grace ends.
   * We log the grace deadline; expiry will arrive as a separate EXPIRATION event.
   */
  private async handleBillingIssue(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    await subscriptionRepo.update(
      { userId },
      { eventTimestampMs: event.event_timestamp_ms ?? null },
    );
    const graceUntil = event.grace_period_expiration_at_ms
      ? new Date(event.grace_period_expiration_at_ms).toISOString()
      : 'none';
    this.logger.warn(`Billing issue for user ${userId} (grace_until=${graceUntil})`);
  }

  /** SUBSCRIPTION_PAUSED → status=PAUSED; no access during pause. */
  private async handlePaused(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    await subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.PAUSED,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    this.logger.log(`Subscription paused for user ${userId}`);
  }

  /**
   * TRANSFER — relink subscription row from transferred_from userId to transferred_to.
   * RC sends both as arrays; we use the first ID in each. Validates both exist before
   * relinking to prevent silent privilege grants.
   */
  private async handleTransfer(
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    userRepo: Repository<User>,
  ): Promise<string[]> {
    const fromId = event.transferred_from?.[0];
    const toId = event.transferred_to?.[0];

    if (!fromId || !toId) {
      this.logger.error(
        `TRANSFER event ${event.id} missing transferred_from/transferred_to — skipping`,
      );
      return [];
    }
    if ((event.transferred_from?.length ?? 0) > 1 || (event.transferred_to?.length ?? 0) > 1) {
      this.logger.warn(
        `TRANSFER event ${event.id} has multiple from/to IDs — using first only ` +
          `(from=${event.transferred_from?.join(',')}, to=${event.transferred_to?.join(',')})`,
      );
    }

    const [fromUser, toUser] = await Promise.all([
      userRepo.findOne({ where: { id: fromId } }),
      userRepo.findOne({ where: { id: toId } }),
    ]);

    if (!fromUser) {
      this.logger.warn(`TRANSFER: source user ${fromId} not found — skipping`);
      return [];
    }
    if (!toUser) {
      this.logger.warn(`TRANSFER: destination user ${toId} not found — skipping`);
      return [];
    }

    // Lock rows in consistent userId order to prevent AB/BA deadlock on concurrent swapped TRANSFERs.
    const [firstId, secondId] = [fromId, toId].sort();
    const [firstRow, secondRow] = await Promise.all([
      subscriptionRepo.findOne({ where: { userId: firstId }, lock: { mode: 'pessimistic_write' } }),
      subscriptionRepo.findOne({ where: { userId: secondId }, lock: { mode: 'pessimistic_write' } }),
    ]);
    const subscription = firstId === fromId ? firstRow : secondRow;
    const existingDestination = firstId === toId ? firstRow : secondRow;

    if (!subscription) {
      this.logger.warn(`TRANSFER: no subscription found for source user ${fromId} — skipping`);
      return [];
    }

    if (existingDestination) {
      this.logger.error(
        `TRANSFER event ${event.id}: destination user ${toId} already has subscription id=${existingDestination.id} — conflict with source user ${fromId}`,
      );
      throw new ConflictException(
        `Cannot transfer subscription: destination user ${toId} already has an active subscription`,
      );
    }

    await subscriptionRepo.update(subscription.id, {
      userId: toId,
      eventTimestampMs: event.event_timestamp_ms ?? null,
    });
    this.logger.log(`Subscription transferred from user ${fromId} to ${toId}`);
    return [fromId, toId];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapProductToPlan(productId: string): SubscriptionPlan {
    const lower = productId.toLowerCase();
    if (lower.includes('lifetime')) return SubscriptionPlan.LIFETIME;
    if (lower.includes('yearly') || lower.includes('annual')) return SubscriptionPlan.YEARLY;
    if (lower.includes('monthly')) return SubscriptionPlan.MONTHLY;
    return SubscriptionPlan.MONTHLY;
  }

  /**
   * Returns true if the user has an active non-free subscription.
   * Used by resource-level access guards.
   */
  async isUserPremium(userId: string): Promise<boolean> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription || subscription.plan === SubscriptionPlan.FREE) return false;
    return this.isSubscriptionActive(subscription);
  }

  /**
   * Check if subscription is currently active (considers expiration and status).
   */
  isSubscriptionActive(subscription: Subscription): boolean {
    if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
    if (subscription.plan === SubscriptionPlan.LIFETIME) return true;
    if (!subscription.currentPeriodEnd) return true;
    return subscription.currentPeriodEnd > new Date();
  }

  private mapToDto(subscription: Subscription): SubscriptionDto {
    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      expiresAt: subscription.currentPeriodEnd,
      isActive: this.isSubscriptionActive(subscription),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  /**
   * Apply RC ground truth to a user's subscription row.
   * Safe to call concurrently with webhook handlers — the out-of-order
   * timestamp guard (event_timestamp_ms) prevents stale writes.
   *
   * @param source - 'fallback' (PremiumGuard read-path) | 'cron' (reconciliation)
   */
  async applyRcGroundTruth(
    userId: string,
    rcPayload: RcSubscriberPayload,
    source: 'fallback' | 'cron' = 'cron',
  ): Promise<void> {
    const incomingTs = rcPayload.fetchedAtMs;
    let changed = false;

    await this.dataSource.transaction(async (mgr) => {
      const existing = await mgr.findOne(Subscription, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      // Out-of-order guard: skip if stored timestamp is same or newer
      if (existing && existing.eventTimestampMs !== null && incomingTs <= existing.eventTimestampMs) {
        this.logger.warn(
          `applyRcGroundTruth: stale payload ts=${incomingTs} <= stored=${existing.eventTimestampMs} for user ${userId} (source=${source}) — skipping`,
        );
        return;
      }

      const hasActive = rcPayload.hasActiveEntitlement;
      const expiresAtMs = rcPayload.activeExpiresAtMs;
      const productId = rcPayload.activeProductId;

      if (hasActive && productId) {
        const plan = this.mapProductToPlan(productId);
        const currentPeriodEnd = expiresAtMs ? new Date(expiresAtMs) : undefined;
        const beforeStatus = existing?.status ?? 'none';

        if (existing) {
          await mgr.update(Subscription, existing.id, {
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            eventTimestampMs: incomingTs,
          });
        } else {
          const sub = mgr.create(Subscription, {
            userId,
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
            eventTimestampMs: incomingTs,
          });
          await mgr.save(Subscription, sub);
        }

        this.logger.log(
          `applyRcGroundTruth: ACTIVE applied for user ${userId} plan=${plan} (${beforeStatus}→ACTIVE source=${source})`,
        );
        changed = true;
      } else if (existing && existing.status === SubscriptionStatus.ACTIVE) {
        // RC says no active entitlement but DB says ACTIVE — expire the row
        await mgr.update(Subscription, existing.id, {
          status: SubscriptionStatus.EXPIRED,
          cancelAtPeriodEnd: false,
          eventTimestampMs: incomingTs,
        });
        this.logger.log(
          `applyRcGroundTruth: EXPIRED applied for user ${userId} (ACTIVE→EXPIRED source=${source})`,
        );
        changed = true;
      } else {
        this.logger.debug(
          `applyRcGroundTruth: no change needed for user ${userId} (source=${source})`,
        );
      }
    });
    // Emit after transaction commits so guard re-reads committed state
    if (changed) this.emitChanged(userId);
  }
}
