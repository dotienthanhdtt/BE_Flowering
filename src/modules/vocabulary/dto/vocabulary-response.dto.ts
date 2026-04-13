import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VocabularyItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  word!: string;

  @ApiProperty()
  translation!: string;

  @ApiProperty()
  sourceLang!: string;

  @ApiProperty()
  targetLang!: string;

  @ApiPropertyOptional()
  partOfSpeech?: string;

  @ApiPropertyOptional()
  pronunciation?: string;

  @ApiPropertyOptional()
  definition?: string;

  @ApiPropertyOptional({ type: [String] })
  examples?: string[];

  @ApiProperty({ description: 'Current Leitner box (1–5)' })
  box!: number;

  @ApiProperty({ description: 'Next review due-at timestamp' })
  dueAt!: Date;

  @ApiPropertyOptional({ description: 'Timestamp of last review' })
  lastReviewedAt?: Date | null;

  @ApiProperty({ description: 'Total reviews performed' })
  reviewCount!: number;

  @ApiProperty({ description: 'Number of correct reviews' })
  correctCount!: number;

  @ApiProperty()
  createdAt!: Date;
}

export class VocabularyListDto {
  @ApiProperty({ type: [VocabularyItemDto] })
  items!: VocabularyItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
