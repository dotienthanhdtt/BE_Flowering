import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ProficiencyLevel } from '../../../database/entities/user-language.entity';

/**
 * DTO for updating user's language proficiency or active status
 */
export class UpdateUserLanguageDto {
  @ApiPropertyOptional({
    description: 'Updated proficiency level',
    enum: ProficiencyLevel,
  })
  @IsOptional()
  @IsEnum(ProficiencyLevel)
  proficiencyLevel?: ProficiencyLevel;

  @ApiPropertyOptional({ description: 'Whether actively learning' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
