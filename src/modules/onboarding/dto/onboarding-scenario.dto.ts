import { IsEnum, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type ScenarioAccentColor = 'primary' | 'blue' | 'green' | 'lavender' | 'rose';

export const SCENARIO_ACCENT_COLORS = ['primary', 'blue', 'green', 'lavender', 'rose'] as const;

export class OnboardingScenarioDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty({ example: 'briefcase' })
  @IsString()
  icon!: string;

  @ApiProperty({ enum: SCENARIO_ACCENT_COLORS })
  @IsEnum(SCENARIO_ACCENT_COLORS)
  accentColor!: ScenarioAccentColor;
}
