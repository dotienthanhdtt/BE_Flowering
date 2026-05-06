import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
  MinLength,
  Length,
  ValidateIf,
} from 'class-validator';

export class OnboardingChatDto {
  @ApiPropertyOptional({
    description:
      'Conversation ID from a previous session. If omitted, a new session is created and nativeLanguage + targetLanguage are required.',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({
    example: 'vi',
    description: 'ISO 639-1 native language code (required when conversationId is absent)',
  })
  @ValidateIf((o: OnboardingChatDto) => !o.conversationId)
  @IsString()
  @Length(2, 5)
  nativeLanguage?: string;

  @ApiPropertyOptional({
    example: 'en',
    description: 'ISO 639-1 target language code (required when conversationId is absent)',
  })
  @ValidateIf((o: OnboardingChatDto) => !o.conversationId)
  @IsString()
  @Length(2, 5)
  targetLanguage?: string;

  @ApiPropertyOptional({
    example: 'Hi! My name is Thanh',
    description:
      'User message. Required after first turn; omit or send empty on first turn to get initial AI greeting.',
  })
  // Normalize empty/whitespace-only to undefined so @IsOptional() applies.
  // Clients (e.g. Flutter) often send message: "" on the first turn — that's valid and must not 400.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;
}
