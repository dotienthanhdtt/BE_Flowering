import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioPersonalDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty() languageId!: string;
  @ApiProperty() addedAt!: Date;
  @ApiProperty({ enum: ['kol', 'personalized'] }) source!: 'kol' | 'personalized';
  /** Present and true when the user is free and this is a premium scenario */
  @ApiPropertyOptional() locked?: boolean;
}
