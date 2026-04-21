import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateUserLanguageDto {
  @ApiPropertyOptional({
    description: 'Updated proficiency level (framework-native, e.g. B1, N3, HSK3, TOPIK3)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  proficiencyLevel?: string;

  @ApiPropertyOptional({ description: 'Whether actively learning' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
