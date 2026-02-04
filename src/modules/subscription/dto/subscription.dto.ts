import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../../database/entities/subscription.entity';

/** DTO for subscription response */
export class SubscriptionDto {
  @ApiProperty({ description: 'Subscription ID' })
  id!: string;

  @ApiProperty({ description: 'Plan type', enum: SubscriptionPlan })
  plan!: SubscriptionPlan;

  @ApiProperty({ description: 'Subscription status', enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiPropertyOptional({ description: 'Current period end date' })
  expiresAt?: Date | null;

  @ApiProperty({ description: 'Whether subscription is currently active' })
  isActive!: boolean;

  @ApiProperty({ description: 'Whether subscription will cancel at period end' })
  cancelAtPeriodEnd!: boolean;
}
