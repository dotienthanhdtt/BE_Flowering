import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for user profile response with native language info
 */
export class UserProfileDto {
  @ApiProperty({ description: 'User ID' })
  id!: string;

  @ApiProperty({ description: 'User email address' })
  email!: string;

  @ApiPropertyOptional({ description: 'Display name' })
  displayName?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Native language ID' })
  nativeLanguageId?: string;

  @ApiPropertyOptional({ description: 'Native language code' })
  nativeLanguageCode?: string;

  @ApiPropertyOptional({ description: 'Native language name' })
  nativeLanguageName?: string;

  @ApiProperty({ description: 'Account creation date' })
  createdAt!: Date;
}
