import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioDifficulty } from '@/database/entities/scenario.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';

export class CategoryRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export type LockReason = 'premium_required';

export class ScenarioDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiProperty({ enum: ScenarioDifficulty })
  difficulty!: ScenarioDifficulty;

  @ApiProperty()
  languageId!: string;

  @ApiProperty()
  orderIndex!: number;

  @ApiProperty({ type: CategoryRefDto })
  category!: CategoryRefDto;

  @ApiProperty({ enum: AccessTier })
  accessTier!: AccessTier;

  @ApiProperty()
  isLocked!: boolean;

  @ApiPropertyOptional({ enum: ['premium_required'] })
  lockReason?: LockReason;
}
