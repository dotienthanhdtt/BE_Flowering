import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProficiencyLevel } from '../../../database/entities/user-language.entity';

/**
 * DTO for adding a language to user's learning list
 */
export class AddUserLanguageDto {
  @ApiProperty({ description: 'Language ID to add' })
  @IsUUID()
  languageId!: string;

  @ApiPropertyOptional({
    description: 'Initial proficiency level',
    enum: ProficiencyLevel,
    default: ProficiencyLevel.BEGINNER,
  })
  @IsOptional()
  @IsEnum(ProficiencyLevel)
  proficiencyLevel?: ProficiencyLevel;
}
