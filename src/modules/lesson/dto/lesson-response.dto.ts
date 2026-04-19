import { ApiProperty } from '@nestjs/swagger';
import { ScenarioDifficulty } from '../../../database/entities/scenario.entity';

export enum ScenarioStatus {
  AVAILABLE = 'available',
  LOCKED = 'locked',
  LEARNED = 'learned',
}

export class ScenarioItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ enum: ScenarioDifficulty })
  difficulty!: ScenarioDifficulty;

  @ApiProperty({ enum: ScenarioStatus })
  status!: ScenarioStatus;
}

export class CategoryWithScenariosDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [ScenarioItemDto] })
  scenarios!: ScenarioItemDto[];
}

export class PaginationDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;
}

export class GetLessonsResponseDto {
  @ApiProperty({ type: [CategoryWithScenariosDto] })
  categories!: CategoryWithScenariosDto[];

  @ApiProperty()
  pagination!: PaginationDto;
}
