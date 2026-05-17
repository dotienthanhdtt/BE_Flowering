import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioInfoDto } from './scenario-chat.dto';
import { AccessTier } from '@/database/entities/access-tier.enum';

export class ScenarioCompleteRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Conversation to finalize' })
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;
}

export class ScenarioEvaluationDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  overall_score!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  fluency_score!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  accuracy_score!: number;

  @ApiProperty({ type: [String] })
  strengths!: string[];

  @ApiProperty({ type: [String] })
  improvements!: string[];

  @ApiProperty()
  summary!: string;
}

export type EvaluationErrorCode = 'llm_unavailable' | 'parse_failed' | 'timeout' | 'invalid_response' | 'retry_cap_reached';

export class NextScenarioCategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class NextScenarioItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true }) image_url!: string | null;
  @ApiProperty({ enum: AccessTier }) access_tier!: AccessTier;
  @ApiProperty({ type: () => NextScenarioCategoryDto, nullable: true })
  category!: NextScenarioCategoryDto | null;
  @ApiProperty() is_locked!: boolean;
}

export class ScenarioCompleteResponseDto {
  @ApiProperty({ type: () => ScenarioInfoDto })
  scenario!: ScenarioInfoDto;

  @ApiProperty({ type: () => ScenarioEvaluationDto, nullable: true })
  evaluation!: ScenarioEvaluationDto | null;

  @ApiPropertyOptional({
    enum: ['llm_unavailable', 'parse_failed', 'timeout', 'invalid_response', 'retry_cap_reached'],
  })
  evaluation_error?: EvaluationErrorCode;

  @ApiProperty({ type: [NextScenarioItemDto] })
  next_scenarios!: NextScenarioItemDto[];
}
