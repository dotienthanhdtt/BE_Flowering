import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../../database/entities/device-token.entity';

/**
 * DTO for registering a device for push notifications
 */
export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM token from Firebase' })
  @IsString()
  token!: string;

  @ApiProperty({ description: 'Device platform', enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiPropertyOptional({ description: 'Device name for identification' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}
