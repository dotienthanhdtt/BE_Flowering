import { ApiProperty } from '@nestjs/swagger';

export class BoxDistributionEntryDto {
  @ApiProperty({ description: 'Leitner box (1–5)' })
  box!: number;

  @ApiProperty({ description: 'Number of cards in this box' })
  count!: number;
}

export class ReviewCompleteResponseDto {
  @ApiProperty({ description: 'Total cards rated in session' })
  total!: number;

  @ApiProperty({ description: 'Number rated correct' })
  correct!: number;

  @ApiProperty({ description: 'Number rated wrong' })
  wrong!: number;

  @ApiProperty({ description: 'Accuracy percentage (0–100, rounded)' })
  accuracy!: number;

  @ApiProperty({
    type: [BoxDistributionEntryDto],
    description: 'Current box distribution for the user across all vocabulary',
  })
  boxDistribution!: BoxDistributionEntryDto[];
}
