import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, IsUUID } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  password!: string;

  @ApiProperty({ required: false, description: 'Onboarding session token to link conversation' })
  @IsUUID()
  @IsOptional()
  sessionToken?: string;
}
