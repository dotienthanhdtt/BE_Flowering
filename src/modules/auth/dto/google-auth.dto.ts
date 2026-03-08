import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID token from Sign in with Google SDK' })
  @IsString()
  idToken!: string;

  @ApiProperty({ required: false, description: 'User display name' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ required: false, description: 'Onboarding session token to link conversation' })
  @IsUUID()
  @IsOptional()
  sessionToken?: string;
}
