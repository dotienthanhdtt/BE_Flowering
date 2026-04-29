import { ApiProperty } from '@nestjs/swagger';
import { LanguageDto } from './language.dto';

export class UserLanguageDto {
  @ApiProperty({ description: 'User language record ID' })
  id!: string;

  @ApiProperty({ description: 'Language ID' })
  languageId!: string;

  @ApiProperty({
    description:
      "Current proficiency level (framework-native). Valid values depend on the language's levelFramework (CEFR: A1-C2, JLPT: N5-N1, HSK: HSK1-HSK6, TOPIK: TOPIK1-TOPIK6).",
    examples: {
      CEFR: { value: 'A1', summary: 'CEFR beginner' },
      JLPT: { value: 'N5', summary: 'JLPT beginner' },
      HSK: { value: 'HSK1', summary: 'HSK beginner' },
      TOPIK: { value: 'TOPIK1', summary: 'TOPIK beginner' },
    },
  })
  proficiencyLevel!: string;

  @ApiProperty({
    description: 'True if this is the most recently learned language for the user',
    default: true,
  })
  lastLearned!: boolean;

  @ApiProperty({ description: 'Date added to learning list' })
  createdAt!: Date;

  @ApiProperty({
    description: 'Language details including code, names, flag and available levels',
    type: LanguageDto,
  })
  language!: LanguageDto;
}
