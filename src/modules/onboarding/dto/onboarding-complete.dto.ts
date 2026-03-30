import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OnboardingCompleteDto {
  @ApiProperty({ description: 'Conversation ID from POST /onboarding/start' })
  @IsUUID()
  conversationId!: string;
}
