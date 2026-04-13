import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class VocabularyQueryDto {
  @ApiPropertyOptional({ description: 'Filter by target language code (e.g. "en", "es")' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  languageCode?: string;

  @ApiPropertyOptional({ description: 'Filter by Leitner box (1–5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  box?: number;

  @ApiPropertyOptional({ description: 'Case-insensitive search over word and translation' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
