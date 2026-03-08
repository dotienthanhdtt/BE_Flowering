import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class OnboardingChatDto {
  @ApiProperty({ description: 'Session token from POST /onboarding/start' })
  @IsUUID()
  sessionToken!: string;

  @ApiProperty({ example: 'Hi! My name is Thanh', description: 'User message' })
  @IsString()
  @MaxLength(2000)
  message!: string;
}
