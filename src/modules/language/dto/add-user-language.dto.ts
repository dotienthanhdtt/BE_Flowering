import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsValidLevelForLanguage } from '../../../common/validators/is-valid-level-for-language.validator';

export class AddUserLanguageDto {
  @ApiProperty({ description: 'Language ID to add' })
  @IsUUID()
  languageId!: string;

  @ApiPropertyOptional({
    description: 'Initial proficiency level (framework-native, e.g. A1, N3, HSK2, TOPIK1)',
    examples: {
      CEFR: { value: 'A1' },
      JLPT: { value: 'N5' },
      HSK: { value: 'HSK1' },
      TOPIK: { value: 'TOPIK1' },
    },
  })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  @IsValidLevelForLanguage('languageId')
  proficiencyLevel?: string;
}
