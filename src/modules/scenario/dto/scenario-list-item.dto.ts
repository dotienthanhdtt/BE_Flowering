import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty() languageId!: string;
  @ApiProperty({ enum: ['system', 'kol', 'personal'] }) type!: string;
  @ApiProperty({ enum: ['system', 'kol', 'personalized'] }) source!: string;
  @ApiProperty() addedAt!: Date;
  @ApiPropertyOptional() locked?: boolean;
}
