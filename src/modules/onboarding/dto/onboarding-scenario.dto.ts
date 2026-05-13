import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingScenarioDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  description!: string;
}
