import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioDefaultDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty() languageId!: string;
  @ApiProperty() orderIndex!: number;
  /** Present and true when the user is free and this is a premium scenario */
  @ApiPropertyOptional() locked?: boolean;
}
