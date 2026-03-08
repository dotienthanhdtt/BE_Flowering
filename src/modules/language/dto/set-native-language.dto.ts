import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * DTO for setting user's native language
 */
export class SetNativeLanguageDto {
  @ApiProperty({ description: 'Language ID to set as native language' })
  @IsUUID()
  languageId!: string;
}
