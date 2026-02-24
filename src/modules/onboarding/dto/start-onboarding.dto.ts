import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class StartOnboardingDto {
  @ApiProperty({ example: 'vi', description: 'ISO 639-1 native language code' })
  @IsString()
  @Length(2, 5)
  nativeLanguage!: string;

  @ApiProperty({ example: 'en', description: 'ISO 639-1 target language code' })
  @IsString()
  @Length(2, 5)
  targetLanguage!: string;
}
