import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ReviewStartDto {
  @ApiPropertyOptional({ description: 'Filter due cards by target language code' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  languageCode?: string;

  @ApiPropertyOptional({ description: 'Max cards to include in session (default 20, max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ReviewCardDto {
  @ApiProperty({ format: 'uuid' })
  vocabId!: string;

  @ApiProperty()
  word!: string;

  @ApiProperty()
  translation!: string;

  @ApiPropertyOptional()
  pronunciation?: string;

  @ApiPropertyOptional()
  partOfSpeech?: string;

  @ApiPropertyOptional()
  definition?: string;

  @ApiPropertyOptional({ type: [String] })
  examples?: string[];

  @ApiProperty({ description: 'Current Leitner box' })
  box!: number;

  @ApiProperty()
  sourceLang!: string;

  @ApiProperty()
  targetLang!: string;
}

export class ReviewStartResponseDto {
  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ type: [ReviewCardDto] })
  cards!: ReviewCardDto[];

  @ApiProperty({ description: 'Number of cards in session' })
  total!: number;
}
