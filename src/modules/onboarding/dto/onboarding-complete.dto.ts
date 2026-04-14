import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OnboardingCompleteDto {
  @ApiProperty({ description: 'Conversation ID obtained from the first POST /onboarding/chat response' })
  @IsUUID()
  conversationId!: string;
}
