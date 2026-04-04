import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class FirebaseAuthDto {
  @ApiProperty({ description: 'Firebase ID token from Firebase Auth SDK' })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiProperty({ required: false, description: 'User display name' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ required: false, description: 'Onboarding conversation ID to link' })
  @IsUUID()
  @IsOptional()
  conversationId?: string;
}
