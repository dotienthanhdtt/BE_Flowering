import { ApiProperty } from '@nestjs/swagger';
import { ProficiencyLevel } from '../../../database/entities/user-language.entity';
import { LanguageDto } from './language.dto';

/**
 * DTO for user's learning language with proficiency info
 */
export class UserLanguageDto {
  @ApiProperty({ description: 'User language record ID' })
  id!: string;

  @ApiProperty({ description: 'Language ID' })
  languageId!: string;

  @ApiProperty({ description: 'Proficiency level', enum: ProficiencyLevel })
  proficiencyLevel!: ProficiencyLevel;

  @ApiProperty({ description: 'Whether actively learning', default: true })
  isActive!: boolean;

  @ApiProperty({ description: 'Date added to learning list' })
  createdAt!: Date;

  @ApiProperty({ description: 'Language details', type: LanguageDto })
  language!: LanguageDto;
}
