import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    description: 'Ordered proficiency levels for this language; null for frameworkless languages (vi, th)',
    example: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    nullable: true,
    type: [String],
  })
  levels!: string[] | null;
}
