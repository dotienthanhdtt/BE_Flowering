import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsObject,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LLMModel } from '../providers/llm-models.enum';

/**
 * Context for conversation sessions.
 */
export class ConversationContext {
  @ApiProperty({ description: 'Conversation session ID' })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ description: 'Target language being learned', example: 'Japanese' })
  @IsString()
  @MaxLength(50)
  targetLanguage!: string;

  @ApiProperty({ description: 'User native language', example: 'Vietnamese' })
  @IsString()
  @MaxLength(50)
  nativeLanguage!: string;

  @ApiProperty({
    description: 'User proficiency level',
    example: 'intermediate',
    enum: ['beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced'],
  })
  @IsString()
  @MaxLength(20)
  proficiencyLevel!: string;

  @ApiPropertyOptional({ description: 'Current lesson topic', example: 'Greetings' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lessonTopic?: string;
}

/**
 * Request DTO for chat endpoint.
 */
export class ChatRequestDto {
  @ApiProperty({ description: 'User message to send to AI tutor', maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  message!: string;

  @ApiProperty({ type: ConversationContext })
  @ValidateNested()
  @Type(() => ConversationContext)
  context!: ConversationContext;

  @ApiPropertyOptional({
    description: 'Override default LLM model',
    enum: LLMModel,
  })
  @IsOptional()
  @IsEnum(LLMModel)
  model?: LLMModel;
}

/**
 * Response DTO for chat endpoint.
 */
export class ChatResponseDto {
  @ApiProperty({ description: 'AI tutor response message' })
  message!: string;

  @ApiProperty({ description: 'Conversation session ID' })
  conversationId!: string;
}

/**
 * DTO for creating a new conversation.
 */
export class CreateConversationDto {
  @ApiProperty({ description: 'Language being learned' })
  @IsUUID()
  languageId!: string;

  @ApiPropertyOptional({ description: 'Conversation title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Conversation topic' })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
