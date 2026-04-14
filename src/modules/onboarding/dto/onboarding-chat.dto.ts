import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, IsOptional, MaxLength, MinLength } from 'class-validator';

export class OnboardingChatDto {
  @ApiProperty({ description: 'Conversation ID from POST /onboarding/start' })
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional({
    example: 'Hi! My name is Thanh',
    description:
      'User message. Required after first turn; omit or send empty on first turn to get initial AI greeting.',
  })
  // Normalize empty/whitespace-only to undefined so @IsOptional() applies.
  // Clients (e.g. Flutter) often send message: "" on the first turn — that's valid and must not 400.
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;
}
