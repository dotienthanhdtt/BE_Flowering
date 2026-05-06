import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ScenarioDifficulty } from '../../../database/entities/scenario.entity';

/**
 * Query params for GET /lessons endpoint
 */
export class GetLessonsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by language ID' })
  @IsOptional()
  @IsUUID()
  language?: string;

  @ApiPropertyOptional({ description: 'Filter by difficulty level', enum: ScenarioDifficulty })
  @IsOptional()
  @IsEnum(ScenarioDifficulty)
  level?: ScenarioDifficulty;

  @ApiPropertyOptional({ description: 'Search scenarios by title' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
