import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * DTO for setting user's native language
 */
export class SetNativeLanguageDto {
  @ApiProperty({ description: 'Language code to set as native language (e.g., "vi", "en")' })
  @IsString()
  @MaxLength(10)
  languageCode!: string;
}
