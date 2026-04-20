import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RedeemScenarioDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  giftCode!: string;
}

export class RedeemedScenarioItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description?: string;
  @ApiProperty() difficulty!: string;
  @ApiProperty() languageId!: string;
}

export class RedeemResponseDto {
  @ApiProperty({ type: [RedeemedScenarioItemDto] }) scenarios!: RedeemedScenarioItemDto[];
}
