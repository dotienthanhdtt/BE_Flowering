import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateUserLanguageDto {
  @ApiPropertyOptional({
    description:
      "Updated proficiency level. Valid values depend on the language's levelFramework (CEFR: A1-C2, JLPT: N5-N1, HSK: HSK1-HSK6, TOPIK: TOPIK1-TOPIK6).",
    examples: {
      CEFR: { value: 'B1', summary: 'CEFR intermediate' },
      JLPT: { value: 'N3', summary: 'JLPT intermediate' },
      HSK: { value: 'HSK3', summary: 'HSK intermediate' },
      TOPIK: { value: 'TOPIK3', summary: 'TOPIK intermediate' },
    },
  })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  proficiencyLevel?: string;

  @ApiPropertyOptional({
    description: 'Mark this as the user\'s most recently learned language',
  })
  @IsOptional()
  @IsBoolean()
  lastLearned?: boolean;
}
