import { ApiProperty } from '@nestjs/swagger';

export class PaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}

export class ListScenariosResponseDto<T> {
  @ApiProperty({ type: Array }) items!: T[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
}
