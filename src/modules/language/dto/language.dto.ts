import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FrameworkLevelDto {
  @ApiProperty({ description: 'Level code (e.g., A1, N5, HSK1)' })
  code!: string;

  @ApiProperty({ description: 'Human-readable level description' })
  description!: string;
}

export class LanguageDto {
  @ApiProperty({ description: 'Language ID' })
  id!: string;

  @ApiProperty({ description: 'Language code (e.g., en, vi, ja)' })
  code!: string;

  @ApiProperty({ description: 'Language name in English' })
  name!: string;

  @ApiPropertyOptional({ description: 'Language name in native script' })
  nativeName?: string;

  @ApiPropertyOptional({ description: 'URL to language flag image' })
  flagUrl?: string;

  @ApiProperty({ description: 'Available as native language option' })
  isNativeAvailable!: boolean;

  @ApiProperty({ description: 'Available as learning language option' })
  isLearningAvailable!: boolean;

  @ApiProperty({
    description:
      'Ordered proficiency levels for this language with descriptions. Empty array if no framework levels are seeded.',
    type: [FrameworkLevelDto],
  })
  levels!: FrameworkLevelDto[];
}
