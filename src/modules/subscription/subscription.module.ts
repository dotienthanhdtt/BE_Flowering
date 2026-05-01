import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { RevenuecatWebhookController } from './webhooks/revenuecat-webhook.controller';
import { RevenueCatRestClient } from './clients/revenuecat-rest-client';
import { SubscriptionReconciliationCron } from './cron/subscription-reconciliation.cron';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { WebhookEvent } from '../../database/entities/webhook-event.entity';

/**
 * Subscription module: subscriptions, RevenueCat webhooks, REST fallback, and nightly reconciliation.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User, WebhookEvent])],
  controllers: [SubscriptionController, RevenuecatWebhookController],
  providers: [SubscriptionService, RevenueCatRestClient, SubscriptionReconciliationCron],
  exports: [SubscriptionService, RevenueCatRestClient],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SubscriptionModule {}
