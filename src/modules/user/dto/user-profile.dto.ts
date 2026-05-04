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

  @ApiPropertyOptional({ description: 'Native language code (e.g., "vi", "en")' })
  nativeLanguage?: string;

  @ApiPropertyOptional({
    description: 'Active learning language code (from user_languages where last_learned = true)',
  })
  activeLanguage?: string;

  @ApiProperty({ description: 'Account creation date' })
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      'Onboarding-extracted profile (same shape as POST /onboarding/complete response). Null until onboarding extraction completes.',
    type: 'object',
    additionalProperties: true,
  })
  profile?: Record<string, unknown> | null;
}
