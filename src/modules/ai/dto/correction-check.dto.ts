import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';

/**
 * Request DTO for chat correction check endpoint.
 */
export class CorrectionCheckRequestDto {
  @ApiProperty({ description: 'Previous AI message for context', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  previousAiMessage!: string;

  @ApiProperty({ description: 'User reply to check for errors', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  userMessage!: string;

  @ApiProperty({ description: 'Target language code', example: 'ja', maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  targetLanguage!: string;

  @ApiPropertyOptional({ description: 'Conversation ID to group trace with chat session' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

/**
 * Response DTO for chat correction check.
 * correctedText is null when user message has no errors.
 */
export class CorrectionCheckResponseDto {
  @ApiPropertyOptional({
    description: 'Corrected text if errors found, null if correct',
    type: String,
    nullable: true,
  })
  correctedText!: string | null;
}
