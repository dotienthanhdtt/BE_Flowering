import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsObject,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** All RevenueCat webhook event types — see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields */
export type RevenueCatEventType =
  | 'TEST'
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'REFUND'
  | 'UNCANCELLATION'
  | 'NON_RENEWING_PURCHASE'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'TRANSFER'
  | 'SUBSCRIPTION_EXTENDED'
  | 'TEMPORARY_ENTITLEMENT_GRANT'
  | 'REFUND_REVERSED'
  | 'INVOICE_ISSUANCE'
  | 'VIRTUAL_CURRENCY_TRANSACTION'
  | 'EXPERIMENT_ENROLLMENT';

/**
 * Cancel reason values from RevenueCat CANCELLATION events.
 * UNSUBSCRIBE = user-initiated; access continues until period end.
 * CUSTOMER_SUPPORT / BILLING_ERROR = immediate revoke.
 */
export type RevenueCatCancelReason =
  | 'UNSUBSCRIBE'
  | 'BILLING_ERROR'
  | 'DEVELOPER_INITIATED'
  | 'PRICE_INCREASE'
  | 'CUSTOMER_SUPPORT'
  | 'UNKNOWN';

/** EXPIRATION reason — superset of cancel reasons + SUBSCRIPTION_PAUSED. */
export type RevenueCatExpirationReason = RevenueCatCancelReason | 'SUBSCRIPTION_PAUSED';

/**
 * DTO for RevenueCat event payload.
 * Only fields the backend reads are declared; unknown RC fields are stripped
 * by a controller-local ValidationPipe with forbidNonWhitelisted:false
 * (the global pipe forbids unknown props, but RC adds new fields periodically).
 */
export class RevenueCatEventDto {
  @ApiProperty({ description: 'Unique event ID for idempotency' })
  @IsString()
  @MaxLength(255)
  id!: string;

  @ApiProperty({ description: 'Event type' })
  @IsString()
  @MaxLength(64)
  type!: RevenueCatEventType;

  @ApiPropertyOptional({ description: 'App user ID — absent on TRANSFER events' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  app_user_id?: string;

  @ApiPropertyOptional({ description: 'First app user ID ever used by the subscriber' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  original_app_user_id?: string;

  @ApiPropertyOptional({ description: 'All app user IDs ever used by the subscriber' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ description: 'Product ID from store' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  product_id?: string;

  /** PRODUCT_CHANGE only — the new product the subscriber switched to. */
  @ApiPropertyOptional({ description: 'New product ID for PRODUCT_CHANGE events' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  new_product_id?: string;

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

  /** BILLING_ISSUE only — when grace period expires. */
  @ApiPropertyOptional({ description: 'Grace period expiration in ms (BILLING_ISSUE)' })
  @IsOptional()
  @IsNumber()
  grace_period_expiration_at_ms?: number;

  /** SUBSCRIPTION_PAUSED (Play Store) — when the subscription auto-resumes. */
  @ApiPropertyOptional({ description: 'Auto-resume timestamp in ms (SUBSCRIPTION_PAUSED)' })
  @IsOptional()
  @IsNumber()
  auto_resume_at_ms?: number;

  @ApiPropertyOptional({ description: 'Cancel reason for CANCELLATION events' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cancel_reason?: RevenueCatCancelReason;

  @ApiPropertyOptional({ description: 'Expiration reason for EXPIRATION events' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expiration_reason?: RevenueCatExpirationReason;

  /** TRANSFER only: source user IDs losing the subscription (RC sends as array). */
  @ApiPropertyOptional({ description: 'TRANSFER: source user IDs losing the subscription' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  transferred_from?: string[];

  /** TRANSFER only: destination user IDs gaining the subscription (RC sends as array). */
  @ApiPropertyOptional({ description: 'TRANSFER: destination user IDs gaining the subscription' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  transferred_to?: string[];

  @ApiPropertyOptional({ description: 'Environment', enum: ['SANDBOX', 'PRODUCTION'] })
  @IsOptional()
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment?: 'SANDBOX' | 'PRODUCTION';
}

/** DTO for RevenueCat webhook payload */
export class RevenueCatWebhookDto {
  @ApiProperty({ description: 'API version' })
  @IsString()
  @MaxLength(20)
  api_version!: string;

  @ApiProperty({ description: 'Event data', type: RevenueCatEventDto })
  @IsObject()
  @ValidateNested()
  @Type(() => RevenueCatEventDto)
  event!: RevenueCatEventDto;
}
