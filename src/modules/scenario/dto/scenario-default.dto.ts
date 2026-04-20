import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioDifficulty } from '@/database/entities/scenario.entity';

export class ScenarioDefaultDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty({ enum: ScenarioDifficulty }) difficulty!: ScenarioDifficulty;
  @ApiProperty() languageId!: string;
  @ApiProperty() orderIndex!: number;
}
