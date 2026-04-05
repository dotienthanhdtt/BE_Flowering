import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsUrl } from 'class-validator';

export class FirebaseAuthDto {
  @ApiProperty({ description: 'Firebase ID token from Firebase Auth SDK' })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiProperty({ required: false, description: 'Display name from FirebaseAuth.currentUser.displayName or Apple credential' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ required: false, description: 'Photo URL from FirebaseAuth.currentUser.photoURL' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiProperty({ required: false, description: 'Phone number from FirebaseAuth.currentUser.phoneNumber' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ required: false, description: 'Onboarding conversation ID to link' })
  @IsUUID()
  @IsOptional()
  conversationId?: string;
}
