import { ApiProperty } from '@nestjs/swagger';
import { MessageRole } from '../../../database/entities';

/**
 * Single message entry for the resume-transcript response. Intentionally minimal
 * (no metadata, audio, or translation fields) to keep the public anonymous endpoint
 * small and avoid leaking internals.
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
