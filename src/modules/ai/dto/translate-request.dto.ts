import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum TranslateType {
  WORD = 'word',
  SENTENCE = 'sentence',
}

export class TranslateRequestDto {
  @ApiProperty({ enum: TranslateType })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsEnum(TranslateType)
  type!: TranslateType;

  @ApiPropertyOptional({ description: 'Word to translate (required for type=word)' })
  @ValidateIf((o) => o.type.toLowerCase() === TranslateType.WORD)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  text?: string;

  @ApiPropertyOptional({ description: 'Message ID (required for type=sentence)' })
  @ValidateIf((o) => o.type.toLowerCase() === TranslateType.SENTENCE)
  @IsUUID()
  messageId?: string;

  @ApiProperty({ example: 'en' })
  @IsString()
  @MaxLength(10)
  sourceLang!: string;

  @ApiProperty({ example: 'vi' })
  @IsString()
  @MaxLength(10)
  targetLang!: string;

  @ApiPropertyOptional({
    description: 'Session token for anonymous onboarding users (required when no JWT)',
  })
  @IsOptional()
  @IsString()
  sessionToken?: string;

  @ApiPropertyOptional({ description: 'Conversation ID to group trace with chat session' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
