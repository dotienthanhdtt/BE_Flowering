import { ApiProperty } from '@nestjs/swagger';
import { CategoryGroupDto } from './category-group.dto';

export class PaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}

export class ListScenariosResponseDto<T> {
  @ApiProperty({ type: Array }) items!: T[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
}

export class ListScenariosGroupedResponseDto {
  @ApiProperty({ type: [CategoryGroupDto] }) items!: CategoryGroupDto[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
}
