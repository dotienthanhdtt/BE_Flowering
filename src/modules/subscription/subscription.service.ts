import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

/**
 * Service handling subscription operations and RevenueCat webhook processing.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,
  ) {}

  /**
   * Get user's current subscription.
   */
  async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription) return null;
    return this.mapToDto(subscription);
  }

  /**
   * Process RevenueCat webhook event.
   * Guards: sandbox filter → idempotency → out-of-order timestamp → dispatch.
   */
  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    const { event } = payload;

    if (process.env.NODE_ENV === 'production' && event.environment === 'SANDBOX') {
      this.logger.warn(
        `Ignoring SANDBOX event ${event.id} (type: ${event.type}) received in production`,
      );
      return;
    }

    // DB-based idempotency: insert first as lock, catch duplicate key
    try {
      await this.webhookEventRepo.insert({ eventId: event.id, eventType: event.type });
    } catch (error: unknown) {
      const dbError = error as { code?: string };
      if (dbError.code === '23505') {
        this.logger.debug(`Event ${event.id} already processed, skipping`);
        return;
      }
      throw error;
    }

    // TRANSFER has its own user-resolution path; delegate before user lookup.
    if (event.type === 'TRANSFER') {
      await this.handleTransfer(event);
      return;
    }

    const user = await this.userRepo.findOne({ where: { id: event.app_user_id } });
    if (!user) {
      this.logger.warn(`User not found for RevenueCat ID: ${event.app_user_id}`);
      return;
    }

    // Out-of-order guard: skip stale events (NULL stored ts treated as -Infinity)
    const incomingTs = event.event_timestamp_ms ?? null;
    if (incomingTs !== null) {
      const existing = await this.subscriptionRepo.findOne({ where: { userId: user.id } });
      if (
        existing &&
        existing.eventTimestampMs !== null &&
        incomingTs < existing.eventTimestampMs
      ) {
        this.logger.warn(
          `Stale event ${event.id} ts=${incomingTs} < stored=${existing.eventTimestampMs} — skipping`,
        );
        return;
      }
    }

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'PRODUCT_CHANGE':
        await this.handlePurchaseOrRenewal(user.id, event);
        break;
      case 'CANCELLATION':
        await this.handleCancellation(user.id, event);
        break;
      case 'EXPIRATION':
        await this.handleExpiration(user.id, event);
        break;
      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user.id, event);
        break;
      case 'REFUND':
        await this.handleRefund(user.id, event);
        break;
      case 'SUBSCRIPTION_PAUSED':
        await this.handlePaused(user.id, event);
        break;
      default:
        this.logger.warn(`Unhandled RC event type: ${(event as RevenueCatEventDto).type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  private async handlePurchaseOrRenewal(userId: string, event: RevenueCatEventDto): Promise<void> {
    const plan = this.mapProductToPlan(event.product_id);
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
    const purchaseDate = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();

    const existing = await this.subscriptionRepo.findOne({ where: { userId } });
    const tsField = { eventTimestampMs: event.event_timestamp_ms ?? null };

    if (existing) {
      await this.subscriptionRepo.update(existing.id, {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        cancelAtPeriodEnd: false,
        revenuecatId: event.original_app_user_id,
        ...tsField,
      });
    } else {
      const sub = this.subscriptionRepo.create({
        userId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        revenuecatId: event.original_app_user_id,
        ...tsField,
      });
      await this.subscriptionRepo.save(sub);
    }

    this.logger.log(`Subscription activated for user ${userId}: ${plan}`);
  }

  /**
   * CANCELLATION — differentiate by cancel_reason:
   *   UNSUBSCRIBE (or unknown) → period-end (keep ACTIVE, set cancelAtPeriodEnd=true).
   *   CUSTOMER_SUPPORT / BILLING_ERROR → immediate revoke (status=EXPIRED, periodEnd=now).
   */
  private async handleCancellation(userId: string, event: RevenueCatEventDto): Promise<void> {
    const reason = event.cancel_reason as RevenueCatCancelReason | undefined;
    const isImmediateRevoke = reason !== undefined && IMMEDIATE_REVOKE_REASONS.includes(reason);

    if (isImmediateRevoke) {
      await this.subscriptionRepo.update(
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
      await this.subscriptionRepo.update(
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

  private async handleExpiration(userId: string, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    this.logger.log(`Subscription expired for user ${userId}`);
  }

  private async handleBillingIssue(userId: string, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
      { userId },
      { eventTimestampMs: event.event_timestamp_ms ?? null },
    );
    this.logger.warn(`Billing issue for user ${userId}`);
  }

  /** REFUND → immediate access revocation. Triggered only on eventType=REFUND. */
  private async handleRefund(userId: string, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.EXPIRED,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    this.logger.log(`Subscription revoked due to refund for user ${userId}`);
  }

  /** SUBSCRIPTION_PAUSED → status=PAUSED; no access during pause. */
  private async handlePaused(userId: string, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
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
   * Validates both userIds exist before relinking to prevent silent privilege grant.
   */
  private async handleTransfer(event: RevenueCatEventDto): Promise<void> {
    const fromId = event.transferred_from;
    const toId = event.transferred_to;

    if (!fromId || !toId) {
      this.logger.error(
        `TRANSFER event ${event.id} missing transferred_from/transferred_to — skipping`,
      );
      return;
    }

    const [fromUser, toUser] = await Promise.all([
      this.userRepo.findOne({ where: { id: fromId } }),
      this.userRepo.findOne({ where: { id: toId } }),
    ]);

    if (!fromUser) {
      this.logger.warn(`TRANSFER: source user ${fromId} not found — skipping`);
      return;
    }
    if (!toUser) {
      this.logger.warn(`TRANSFER: destination user ${toId} not found — skipping`);
      return;
    }

    const subscription = await this.subscriptionRepo.findOne({ where: { userId: fromId } });
    if (!subscription) {
      this.logger.warn(`TRANSFER: no subscription found for source user ${fromId} — skipping`);
      return;
    }

    await this.subscriptionRepo.update(subscription.id, {
      userId: toId,
      eventTimestampMs: event.event_timestamp_ms ?? null,
    });
    this.logger.log(`Subscription transferred from user ${fromId} to ${toId}`);
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

    // Out-of-order guard: skip if stored timestamp is newer
    const existing = await this.subscriptionRepo.findOne({ where: { userId } });
    if (existing && existing.eventTimestampMs !== null && incomingTs < existing.eventTimestampMs) {
      this.logger.warn(
        `applyRcGroundTruth: stale payload ts=${incomingTs} < stored=${existing.eventTimestampMs} for user ${userId} (source=${source}) — skipping`,
      );
      return;
    }

    const hasActive = rcPayload.hasActiveEntitlement;
    const expiresAtMs = rcPayload.activeExpiresAtMs;
    const productId = rcPayload.activeProductId;

    if (hasActive && productId) {
      // RC says active — upsert as ACTIVE
      const plan = this.mapProductToPlan(productId);
      const currentPeriodEnd = expiresAtMs ? new Date(expiresAtMs) : undefined;
      const beforeStatus = existing?.status ?? 'none';

      if (existing) {
        await this.subscriptionRepo.update(existing.id, {
          plan,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          eventTimestampMs: incomingTs,
        });
      } else {
        const sub = this.subscriptionRepo.create({
          userId,
          plan,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd,
          eventTimestampMs: incomingTs,
        });
        await this.subscriptionRepo.save(sub);
      }

      this.logger.log(
        `applyRcGroundTruth: ACTIVE applied for user ${userId} plan=${plan} (${beforeStatus}→ACTIVE source=${source})`,
      );
    } else if (existing && existing.status === SubscriptionStatus.ACTIVE) {
      // RC says no active entitlement but DB says ACTIVE — expire the row
      await this.subscriptionRepo.update(existing.id, {
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
        eventTimestampMs: incomingTs,
      });
      this.logger.log(
        `applyRcGroundTruth: EXPIRED applied for user ${userId} (ACTIVE→EXPIRED source=${source})`,
      );
    } else {
      // RC says inactive and DB already non-ACTIVE — no change needed
      this.logger.debug(
        `applyRcGroundTruth: no change needed for user ${userId} (source=${source})`,
      );
    }
  }
}
