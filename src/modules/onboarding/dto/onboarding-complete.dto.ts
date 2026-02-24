import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OnboardingCompleteDto {
  @ApiProperty({ description: 'Session token from POST /onboarding/start' })
  @IsUUID()
  sessionToken!: string;
}
