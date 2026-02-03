import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO for updating user profile fields
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Display name', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Native language ID (UUID)' })
  @IsOptional()
  @IsUUID()
  nativeLanguageId?: string;
}
