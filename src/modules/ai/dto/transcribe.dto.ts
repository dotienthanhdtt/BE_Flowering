import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class TranscribeRequestDto {
  @ApiPropertyOptional({ description: 'Onboarding conversation ID for context' })
  @IsOptional()
  @IsUUID()
  conversation_id?: string;
}

export class TranscribeResponseDto {
  @ApiProperty({ description: 'Transcribed text from audio' })
  text!: string;
}
