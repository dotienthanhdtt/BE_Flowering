import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';
export class AppleAuthDto {
  @ApiProperty({ description: 'Apple ID token from Sign in with Apple' })
  @IsString()
  idToken!: string;

  @ApiProperty({
    required: false,
    description: 'User display name (only available on first sign-in)',
  })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ required: false, description: 'Onboarding conversation ID to link' })
  @IsUUID()
  @IsOptional()
  conversationId?: string;
}
