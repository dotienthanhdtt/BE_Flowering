import { ApiProperty } from '@nestjs/swagger';
import { ScenarioListItemDto } from './scenario-list-item.dto';

export class CategorySummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() orderIndex!: number;
}

export class CategoryGroupDto {
  @ApiProperty({ type: CategorySummaryDto }) category!: CategorySummaryDto;
  @ApiProperty({ type: [ScenarioListItemDto] }) scenarios!: ScenarioListItemDto[];
}
