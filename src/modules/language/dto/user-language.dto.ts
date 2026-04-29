import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LanguageDto } from './language.dto';

export class UserLanguageDto {
  @ApiProperty({ description: 'User language record ID' })
  id!: string;

  @ApiProperty({ description: 'Language ID' })
  languageId!: string;

  @ApiProperty({
    description:
      "Current proficiency level (framework-native). Valid values come from the language's framework levels.",
    examples: {
      CEFR: { value: 'A1', summary: 'CEFR beginner' },
      JLPT: { value: 'N5', summary: 'JLPT beginner' },
      HSK: { value: 'HSK1', summary: 'HSK beginner' },
      TOPIK: { value: 'TOPIK1', summary: 'TOPIK beginner' },
    },
  })
  proficiencyLevel!: string;

  @ApiPropertyOptional({
    description: "Human-readable description of the user's current proficiency level",
  })
  description?: string;

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
