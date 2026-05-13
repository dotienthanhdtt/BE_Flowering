import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioChatMessageDto, ScenarioInfoDto } from './scenario-chat.dto';

export class ScenarioCompleteRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Scenario to complete' })
  @IsUUID()
  @IsNotEmpty()
  scenarioId!: string;

  @ApiProperty({ format: 'uuid', description: 'Conversation to finalize' })
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;
}

export class ScenarioVocabUsageItemDto {
  @ApiProperty({ format: 'uuid' })
  vocab_id!: string;

  @ApiProperty()
  word!: string;

  @ApiProperty()
  used!: boolean;
}

export class ScenarioEvaluationDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  overall_score!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  fluency_score!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  accuracy_score!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  vocab_score!: number;

  @ApiProperty({ type: [String] })
  strengths!: string[];

  @ApiProperty({ type: [String] })
  improvements!: string[];

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: [ScenarioVocabUsageItemDto] })
  vocab_usage!: ScenarioVocabUsageItemDto[];
}

export type EvaluationErrorCode = 'llm_unavailable' | 'parse_failed' | 'timeout' | 'invalid_response' | 'retry_cap_reached';

export class ScenarioCompleteResponseDto {
  @ApiProperty({ type: () => ScenarioInfoDto })
  scenario!: ScenarioInfoDto;

  @ApiProperty({ type: [ScenarioChatMessageDto] })
  messages!: ScenarioChatMessageDto[];

  @ApiProperty({ type: () => ScenarioEvaluationDto, nullable: true })
  evaluation!: ScenarioEvaluationDto | null;

  @ApiPropertyOptional({
    enum: ['llm_unavailable', 'parse_failed', 'timeout', 'invalid_response', 'retry_cap_reached'],
  })
  evaluation_error?: EvaluationErrorCode;
}
