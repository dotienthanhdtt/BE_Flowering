import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum LanguageType {
  NATIVE = 'native',
  LEARNING = 'learning',
}

/**
 * DTO for filtering languages by type (native or learning)
 */
export class LanguageQueryDto {
  @ApiPropertyOptional({
    description: 'Filter languages by availability type',
    enum: LanguageType,
  })
  @IsOptional()
  @IsEnum(LanguageType)
  type?: LanguageType;
}
