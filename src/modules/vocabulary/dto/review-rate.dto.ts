import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsUUID } from 'class-validator';

export class ReviewRateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vocabId!: string;

  @ApiProperty({ description: 'true = correct (promote box), false = wrong (reset to box 1)' })
  @IsBoolean()
  correct!: boolean;
}

export class ReviewRateUpdateDto {
  @ApiProperty({ description: 'New Leitner box' })
  box!: number;

  @ApiProperty({ description: 'New due-at timestamp' })
  dueAt!: Date;
}

export class ReviewRateResponseDto {
  @ApiProperty({ type: ReviewRateUpdateDto })
  updated!: ReviewRateUpdateDto;

  @ApiProperty({ description: 'Cards left in session to rate' })
  remaining!: number;
}
