import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioChatStatus } from '@/database/entities/ai-conversation.entity';

export class ScenarioChatRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Scenario to engage with' })
  @IsUUID()
  @IsNotEmpty()
  scenarioId!: string;

  @ApiPropertyOptional({
    description: 'User message. Omit or send empty on first turn to let AI open the conversation.',
  })
  // Normalize empty/whitespace-only to undefined so @IsOptional() applies.
  // Clients (e.g. Flutter) often send message: "" on the first turn — that's valid and must not 400.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Resume an existing conversation' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class ScenarioInfoDto {
  @ApiProperty({ format: 'uuid' })
  conversation_id!: string;

  @ApiProperty()
  max_turns!: number;

  @ApiProperty()
  turn!: number;

  @ApiProperty({ enum: ScenarioChatStatus })
  status!: ScenarioChatStatus;
}

export class ScenarioChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty()
  content!: string;

  @ApiProperty({ description: 'ISO timestamp' })
  created_at!: string;
}

export class ScenarioChatResponseDto {
  @ApiProperty({ type: () => ScenarioInfoDto })
  scenario!: ScenarioInfoDto;

  @ApiProperty({ type: [ScenarioChatMessageDto] })
  messages!: ScenarioChatMessageDto[];
}

export class ScenarioConversationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'ISO timestamp when the conversation was created' })
  startedAt!: string;

  @ApiProperty({ description: 'ISO timestamp of the last activity' })
  lastTurnAt!: string;

  @ApiProperty({ description: 'Number of completed user/assistant turn pairs' })
  turnCount!: number;

  @ApiProperty({ enum: ScenarioChatStatus })
  status!: ScenarioChatStatus;

  @ApiProperty({ description: 'Maximum turns allowed for this conversation' })
  maxTurns!: number;
}

export class ScenarioConversationListResponseDto {
  @ApiProperty({ type: [ScenarioConversationListItemDto] })
  items!: ScenarioConversationListItemDto[];
}
