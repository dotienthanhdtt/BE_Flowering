import { ApiProperty } from '@nestjs/swagger';
import { LanguageDto } from './language.dto';

export class UserLanguageDto {
  @ApiProperty({ description: 'User language record ID' })
  id!: string;

  @ApiProperty({ description: 'Language ID' })
  languageId!: string;

  @ApiProperty({ description: 'Proficiency level (framework-native, e.g. A1, N3, HSK2, TOPIK1)' })
  proficiencyLevel!: string;

  @ApiProperty({ description: 'Whether actively learning', default: true })
  isActive!: boolean;

  @ApiProperty({ description: 'Date added to learning list' })
  createdAt!: Date;

  @ApiProperty({ description: 'Language details including code, names, flag and available levels', type: LanguageDto })
  language!: LanguageDto;
}
