import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/** RevenueCat webhook event types */
export type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE';

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
