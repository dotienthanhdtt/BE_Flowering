import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateUserLanguageDto {
  @ApiPropertyOptional({
    description:
      "Updated proficiency level. Valid values come from the language's framework_levels rows.",
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
