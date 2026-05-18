import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TtsRequestDto {
  @ApiProperty({ description: 'Assistant message UUID to synthesize' })
  @IsUUID()
  messageId!: string;
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
}
