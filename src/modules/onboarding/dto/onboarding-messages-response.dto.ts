import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageRole } from '../../../database/entities';

/**
 * Single message entry for the resume-transcript response.
 * Includes audio/translation/correction fields cached by the TTS gateway,
 * POST /ai/translate, and POST /ai/chat/correct respectively.
 */
export class OnboardingMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: MessageRole })
  role!: MessageRole;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Object-storage key (not a signed URL). Assistant rows: TTS mp3. User rows: STT recording.',
  })
  audio_path?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Cached translation produced by POST /ai/translate (sentence mode).',
  })
  translated_content?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Grammar/vocabulary correction produced by POST /ai/chat/correct. Null = no errors or correction not yet run.',
  })
  corrected_content?: string | null;
}

/**
 * Response body for `GET /onboarding/conversations/:conversationId/messages`.
 * Keys serialized as snake_case by the global ResponseTransformInterceptor.
 */
export class OnboardingMessagesResponseDto {
  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  turnNumber!: number;

  @ApiProperty()
  maxTurns!: number;

  @ApiProperty()
  isLastTurn!: boolean;

  @ApiProperty({ type: [OnboardingMessageDto] })
  messages!: OnboardingMessageDto[];
}
