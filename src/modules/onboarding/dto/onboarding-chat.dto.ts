import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, MaxLength, MinLength } from 'class-validator';

export class OnboardingChatDto {
  @ApiProperty({ description: 'Conversation ID from POST /onboarding/start' })
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional({
    example: 'Hi! My name is Thanh',
    description: 'User message. Required after first turn; omit on first turn to get initial AI greeting.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;
}
