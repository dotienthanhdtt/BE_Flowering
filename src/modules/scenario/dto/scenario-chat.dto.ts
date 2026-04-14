import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioChatRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Scenario to engage with' })
  @IsUUID()
  @IsNotEmpty()
  scenarioId!: string;

  @ApiPropertyOptional({ description: 'Omit on first turn to let AI open the conversation' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Resume an existing conversation' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({
    description:
      'Abandon any active conversation for this scenario and start fresh. Cannot combine with conversationId.',
  })
  @IsOptional()
  @IsBoolean()
  forceNew?: boolean;
}

export class ScenarioChatResponseDto {
  @ApiProperty({ description: 'AI roleplay reply' })
  reply!: string;

  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ description: 'Current turn number (1-based)' })
  turn!: number;

  @ApiProperty({ description: 'Maximum turns for this conversation' })
  maxTurns!: number;

  @ApiProperty({ description: 'True when the conversation has reached the turn cap' })
  completed!: boolean;
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

  @ApiProperty({ description: 'True when the conversation has reached the turn cap' })
  completed!: boolean;

  @ApiProperty({ description: 'Maximum turns allowed for this conversation' })
  maxTurns!: number;
}

export class ScenarioConversationListResponseDto {
  @ApiProperty({ type: [ScenarioConversationListItemDto] })
  items!: ScenarioConversationListItemDto[];
}

export class ScenarioMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty()
  content!: string;

  @ApiProperty({ description: 'ISO timestamp when the message was created' })
  createdAt!: string;
}

export class ScenarioConversationDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  scenarioId!: string;

  @ApiProperty({ description: 'True when the conversation has reached the turn cap' })
  completed!: boolean;

  @ApiProperty({ description: 'Current turn number (1-based)' })
  turn!: number;

  @ApiProperty({ description: 'Maximum turns allowed for this conversation' })
  maxTurns!: number;

  @ApiProperty({ type: [ScenarioMessageDto] })
  messages!: ScenarioMessageDto[];
}
