import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { WebhookEvent } from '../../database/entities/webhook-event.entity';
import { RevenueCatWebhookDto, RevenueCatEventDto } from './dto/revenuecat-webhook.dto';
import { SubscriptionDto } from './dto/subscription.dto';

/**
 * Service handling subscription operations and RevenueCat webhook processing
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
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get user's current subscription
   */
  async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { userId },
    });

    if (!subscription) return null;

    return this.mapToDto(subscription);
  }

  /**
   * Process RevenueCat webhook event
   */
  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    const { event } = payload;

    // DB-based idempotency: insert first as lock, catch duplicate
    try {
      await this.webhookEventRepo.insert({
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error: unknown) {
      const dbError = error as { code?: string };
      if (dbError.code === '23505') {
        this.logger.debug(`Event ${event.id} already processed, skipping`);
        return;
      }
      throw error;
    }

    // Find user by RevenueCat app_user_id (which should be our user ID)
    const user = await this.userRepo.findOne({ where: { id: event.app_user_id } });
    if (!user) {
      this.logger.warn(`User not found for RevenueCat ID: ${event.app_user_id}`);
      return;
    }

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
        await this.handlePurchaseOrRenewal(user.id, event);
        break;
      case 'CANCELLATION':
        await this.handleCancellation(user.id);
        break;
      case 'EXPIRATION':
        await this.handleExpiration(user.id);
        break;
      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user.id);
        break;
      case 'PRODUCT_CHANGE':
        await this.handlePurchaseOrRenewal(user.id, event);
        break;
    }
  }

  /**
   * Handle purchase or renewal event
   */
  private async handlePurchaseOrRenewal(userId: string, event: RevenueCatEventDto): Promise<void> {
    const plan = this.mapProductToPlan(event.product_id);
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
    const purchaseDate = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();

    const existing = await this.subscriptionRepo.findOne({ where: { userId } });

    if (existing) {
      await this.subscriptionRepo.update(existing.id, {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        cancelAtPeriodEnd: false,
        revenuecatId: event.original_app_user_id,
      });
    } else {
      const subscription = this.subscriptionRepo.create({
        userId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        revenuecatId: event.original_app_user_id,
      });
      await this.subscriptionRepo.save(subscription);
    }

    this.logger.log(`Subscription activated for user ${userId}: ${plan}`);
  }

  /**
   * Handle cancellation event - subscription still active until period end
   */
  private async handleCancellation(userId: string): Promise<void> {
    await this.subscriptionRepo.update({ userId }, { cancelAtPeriodEnd: true });
    this.logger.log(`Subscription cancelled (will expire at period end) for user ${userId}`);
  }

  /**
   * Handle expiration event
   */
  private async handleExpiration(userId: string): Promise<void> {
    await this.subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.EXPIRED,
        cancelAtPeriodEnd: false,
      },
    );
    this.logger.log(`Subscription expired for user ${userId}`);
  }

  /**
   * Handle billing issue event
   */
  private async handleBillingIssue(userId: string): Promise<void> {
    // Could send notification to user about billing issue
    this.logger.warn(`Billing issue for user ${userId}`);
  }

  /**
   * Map RevenueCat product ID to our subscription plan
   */
  private mapProductToPlan(productId: string): SubscriptionPlan {
    const lowerProductId = productId.toLowerCase();

    if (lowerProductId.includes('lifetime')) {
      return SubscriptionPlan.LIFETIME;
    }
    if (lowerProductId.includes('yearly') || lowerProductId.includes('annual')) {
      return SubscriptionPlan.YEARLY;
    }
    if (lowerProductId.includes('monthly')) {
      return SubscriptionPlan.MONTHLY;
    }

    return SubscriptionPlan.MONTHLY; // Default to monthly
  }

  /**
   * Sync subscription with RevenueCat REST API.
   * Called by mobile after purchase and on app open.
   */
  async syncSubscription(userId: string): Promise<SubscriptionDto> {
    const rcApiKey = this.configService.get<string>('revenuecat.apiKey');
    if (!rcApiKey) {
      this.logger.warn('RevenueCat API key not configured, returning current subscription');
      return this.ensureFreeSubscription(userId);
    }

    try {
      const response = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${rcApiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(`RevenueCat API returned ${response.status} for user ${userId}`);
        return this.ensureFreeSubscription(userId);
      }

      const data = await response.json();
      return this.upsertFromRevenueCat(userId, data.subscriber);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to sync with RevenueCat for user ${userId}: ${message}`);
      // Fallback: return existing subscription or FREE
      return this.ensureFreeSubscription(userId);
    }
  }

  /**
   * Parse RevenueCat subscriber data and upsert local subscription
   */
  private async upsertFromRevenueCat(
    userId: string,
    subscriber: Record<string, unknown>,
  ): Promise<SubscriptionDto> {
    const entitlements = subscriber.entitlements as Record<string, Record<string, unknown>> | undefined;
    if (!entitlements || Object.keys(entitlements).length === 0) {
      return this.ensureFreeSubscription(userId);
    }

    // Find first active entitlement
    const activeEntitlement = Object.values(entitlements).find(
      (e) => e.expires_date === null || new Date(e.expires_date as string) > new Date(),
    );

    if (!activeEntitlement) {
      return this.ensureFreeSubscription(userId);
    }

    const productId = activeEntitlement.product_identifier as string;
    const plan = this.mapProductToPlan(productId);
    const expiresAt = activeEntitlement.expires_date
      ? new Date(activeEntitlement.expires_date as string)
      : undefined;
    const purchaseDate = activeEntitlement.purchase_date
      ? new Date(activeEntitlement.purchase_date as string)
      : new Date();

    const existing = await this.subscriptionRepo.findOne({ where: { userId } });

    if (existing) {
      await this.subscriptionRepo.update(existing.id, {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        cancelAtPeriodEnd: false,
      });
      return this.mapToDto({ ...existing, plan, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: expiresAt, currentPeriodStart: purchaseDate, cancelAtPeriodEnd: false });
    }

    const subscription = this.subscriptionRepo.create({
      userId,
      plan,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: expiresAt,
      currentPeriodStart: purchaseDate,
    });
    const saved = await this.subscriptionRepo.save(subscription);
    return this.mapToDto(saved);
  }

  /**
   * Ensure user has at least a FREE subscription record
   */
  private async ensureFreeSubscription(userId: string): Promise<SubscriptionDto> {
    const existing = await this.subscriptionRepo.findOne({ where: { userId } });
    if (existing) return this.mapToDto(existing);

    const subscription = this.subscriptionRepo.create({
      userId,
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.ACTIVE,
    });
    const saved = await this.subscriptionRepo.save(subscription);
    return this.mapToDto(saved);
  }

  /**
   * Check if subscription is currently active
   */
  private isSubscriptionActive(subscription: Subscription): boolean {
    if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
    if (subscription.plan === SubscriptionPlan.LIFETIME) return true;
    if (!subscription.currentPeriodEnd) return true;
    return subscription.currentPeriodEnd > new Date();
  }

  /**
   * Map subscription entity to DTO
   */
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
}
