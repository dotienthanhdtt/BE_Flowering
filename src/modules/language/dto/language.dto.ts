import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for language response (available languages list)
 */
export class LanguageDto {
  @ApiProperty({ description: 'Language ID' })
  id!: string;

  @ApiProperty({ description: 'Language code (e.g., en, vi, ja)' })
  code!: string;

  @ApiProperty({ description: 'Language name in English' })
  name!: string;

  @ApiProperty({ description: 'Language name in native script', required: false })
  nativeName?: string;

  @ApiProperty({ description: 'URL to language flag image', required: false })
  flagUrl?: string;
}
