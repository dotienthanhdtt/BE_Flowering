import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/** All RevenueCat webhook event types */
export type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'REFUND'
  | 'SUBSCRIPTION_PAUSED'
  | 'TRANSFER';

/**
 * Cancel reason values from RevenueCat CANCELLATION events.
 * UNSUBSCRIBE = user-initiated; access continues until period end.
 * CUSTOMER_SUPPORT / BILLING_ERROR = immediate revoke.
 */
export type RevenueCatCancelReason =
  | 'UNSUBSCRIBE'
  | 'BILLING_ERROR'
  | 'DEVELOPER'
  | 'PRICE_INCREASE'
  | 'CUSTOMER_SUPPORT'
  | 'UNKNOWN';

/** DTO for RevenueCat event payload */
export class RevenueCatEventDto {
  @ApiProperty({ description: 'Unique event ID for idempotency' })
  @IsString()
  @MaxLength(255)
  id!: string;

  @ApiProperty({ description: 'Event type' })
  @IsString()
  @MaxLength(50)
  type!: RevenueCatEventType;

  @ApiProperty({ description: 'App user ID (our user ID)' })
  @IsString()
  @MaxLength(255)
  app_user_id!: string;

  @ApiProperty({ description: 'Original app user ID' })
  @IsString()
  @MaxLength(255)
  original_app_user_id!: string;

  @ApiProperty({ description: 'Product ID from store' })
  @IsString()
  @MaxLength(255)
  product_id!: string;

  @ApiPropertyOptional({ description: 'Entitlement ID' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  entitlement_id?: string;

  @ApiPropertyOptional({ description: 'Expiration timestamp in ms' })
  @IsOptional()
  @IsNumber()
  expiration_at_ms?: number;

  @ApiPropertyOptional({ description: 'Purchase timestamp in ms' })
  @IsOptional()
  @IsNumber()
  purchased_at_ms?: number;

  @ApiPropertyOptional({ description: 'Event timestamp in ms — used for out-of-order guard' })
  @IsOptional()
  @IsNumber()
  event_timestamp_ms?: number;

  @ApiPropertyOptional({ description: 'Cancel reason for CANCELLATION events' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  cancel_reason?: RevenueCatCancelReason;

  /**
   * TRANSFER only: the app_user_id of the source user losing the subscription.
   * RC docs call this field "transferred_from" inside the event object.
   */
  @ApiPropertyOptional({ description: 'TRANSFER: source user ID losing the subscription' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  transferred_from?: string;

  /**
   * TRANSFER only: the app_user_id of the destination user gaining the subscription.
   * RC docs call this field "transferred_to" inside the event object.
   */
  @ApiPropertyOptional({ description: 'TRANSFER: destination user ID gaining the subscription' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  transferred_to?: string;

  @ApiProperty({ description: 'Environment', enum: ['SANDBOX', 'PRODUCTION'] })
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment!: 'SANDBOX' | 'PRODUCTION';
}

/** DTO for RevenueCat webhook payload */
export class RevenueCatWebhookDto {
  @ApiProperty({ description: 'API version' })
  @IsString()
  @MaxLength(20)
  api_version!: string;

  @ApiProperty({ description: 'Event data', type: RevenueCatEventDto })
  @ValidateNested()
  @Type(() => RevenueCatEventDto)
  event!: RevenueCatEventDto;
}
