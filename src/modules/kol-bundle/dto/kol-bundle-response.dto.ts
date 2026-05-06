import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KolBundleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() giftCode!: string;
  @ApiPropertyOptional() creatorId?: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: [String] }) scenarioIds!: string[];
  @ApiProperty() createdAt!: Date;
}
