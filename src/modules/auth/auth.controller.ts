import { Controller, Post, Body, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public-route.decorator';
import { AuthService } from './auth.service';
import { AuthResponseDto, RefreshTokenDto, FirebaseAuthDto } from './dto';
import { CurrentUser } from './decorators';
import { User } from '../../database/entities/user.entity';

const EMAIL_AUTH_DISABLED_MSG =
  'Email/password authentication is disabled. Please sign in with Google or Apple.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Register new user with email/password (disabled)' })
  @ApiResponse({ status: 410, description: 'Email/password auth disabled' })
  register(): never {
    throw new HttpException(EMAIL_AUTH_DISABLED_MSG, HttpStatus.GONE);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Login with email/password (disabled)' })
  @ApiResponse({ status: 410, description: 'Email/password auth disabled' })
  login(): never {
    throw new HttpException(EMAIL_AUTH_DISABLED_MSG, HttpStatus.GONE);
  }

  @Public()
  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Firebase (Google or Apple)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid Firebase ID token' })
  async firebaseAuth(@Body() dto: FirebaseAuthDto): Promise<AuthResponseDto> {
    return this.authService.firebaseLogin(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Send OTP for password reset (disabled)' })
  @ApiResponse({ status: 410, description: 'Email/password auth disabled' })
  forgotPassword(): never {
    throw new HttpException(EMAIL_AUTH_DISABLED_MSG, HttpStatus.GONE);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Verify OTP (disabled)' })
  @ApiResponse({ status: 410, description: 'Email/password auth disabled' })
  verifyOtp(): never {
    throw new HttpException(EMAIL_AUTH_DISABLED_MSG, HttpStatus.GONE);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Reset password (disabled)' })
  @ApiResponse({ status: 410, description: 'Email/password auth disabled' })
  resetPassword(): never {
    throw new HttpException(EMAIL_AUTH_DISABLED_MSG, HttpStatus.GONE);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout and invalidate all refresh tokens' })
  @ApiResponse({ status: 204, description: 'Successfully logged out' })
  async logout(@CurrentUser() user: User): Promise<void> {
    return this.authService.logout(user.id);
  }
}
