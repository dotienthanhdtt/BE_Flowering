import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class TtsRequestDto {
  @ApiProperty({ description: 'Assistant message UUID to synthesize' })
  @IsUUID()
  messageId!: string;

  @ApiPropertyOptional({
    description:
      'Client-minted Langfuse session id (shared with chat/STT calls so TTS observations land in the same Langfuse session).',
  })
  @IsOptional()
  @IsUUID()
  traceId?: string;
}

export class TtsOnboardingRequestDto {
  @ApiProperty({ description: 'Assistant message UUID to synthesize' })
  @IsUUID()
  messageId!: string;

  @ApiProperty({ description: 'Conversation UUID the message belongs to' })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ description: 'Onboarding session UUID (also used as upload namespace)' })
  @IsUUID()
  sessionId!: string;

  @ApiPropertyOptional({
    description:
      'Client-minted Langfuse session id shared with the onboarding chat (groups TTS observations under the same Langfuse session).',
  })
  @IsOptional()
  @IsUUID()
  traceId?: string;
}
