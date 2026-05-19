import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Request body for PUT /ai/messages/:messageId/corrected-content.
 * Persists grammar/vocabulary correction text on a user message row.
 * Pass null to clear an existing correction.
 */
export class PutCorrectedContentRequestDto {
  @ApiProperty({
    description: 'Corrected text to persist. Pass null to clear correction.',
    nullable: true,
    maxLength: 4000,
    type: String,
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  correctedText!: string | null;
}
