import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { RevenuecatWebhookController } from './webhooks/revenuecat-webhook.controller';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { WebhookEvent } from '../../database/entities/webhook-event.entity';

/**
 * Subscription module for managing user subscriptions and RevenueCat webhooks
 */
@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User, WebhookEvent])],
  controllers: [SubscriptionController, RevenuecatWebhookController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SubscriptionModule {}
