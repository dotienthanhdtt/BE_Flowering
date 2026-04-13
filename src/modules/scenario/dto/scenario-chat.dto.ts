import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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
