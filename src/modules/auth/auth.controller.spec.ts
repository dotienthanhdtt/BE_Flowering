import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, AppleAuthDto, GoogleAuthDto, AuthResponseDto } from './dto';
import { User } from '../../database/entities/user.entity';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockAuthResponse: AuthResponseDto = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: {
      id: 'user-123',
      email: 'test@example.com',
      displayName: 'Test User',
      avatarUrl: undefined,
    },
  };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    passwordHash: 'hashed',
    authProvider: 'email',
    providerId: undefined,
    googleProviderId: undefined,
    appleProviderId: undefined,
    avatarUrl: undefined,
    nativeLanguageId: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            googleLogin: jest.fn(),
            appleLogin: jest.fn(),
            refreshTokens: jest.fn(),
            logout: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register new user successfully', async () => {
      const registerDto: RegisterDto = {
        email: 'new@example.com',
        password: 'SecurePass123!',
        displayName: 'New User',
      };

      authService.register.mockResolvedValue(mockAuthResponse);

      const result = await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(mockAuthResponse);
      expect(result.accessToken).toBe('access-token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw ConflictException if email already exists', async () => {
      const registerDto: RegisterDto = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
      };

      authService.register.mockRejectedValue(new ConflictException('Email already registered'));

      await expect(controller.register(registerDto)).rejects.toThrow(ConflictException);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'SecurePass123!',
      };

      authService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDto);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toEqual(mockAuthResponse);
      expect(result.accessToken).toBe('access-token');
    });

    it('should throw UnauthorizedException with invalid credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'WrongPassword',
      };

      authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      await expect(controller.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });
  });

  describe('googleAuth (POST /auth/google)', () => {
    it('should sign in with Google ID token successfully', async () => {
      const googleAuthDto: GoogleAuthDto = {
        idToken: 'google-id-token',
        displayName: 'Google User',
      };

      authService.googleLogin.mockResolvedValue(mockAuthResponse);

      const result = await controller.googleAuth(googleAuthDto);

      expect(authService.googleLogin).toHaveBeenCalledWith(
        googleAuthDto.idToken,
        googleAuthDto.displayName,
        googleAuthDto.sessionToken,
      );
      expect(result).toEqual(mockAuthResponse);
    });

    it('should throw UnauthorizedException with invalid Google ID token', async () => {
      const googleAuthDto: GoogleAuthDto = {
        idToken: 'invalid-token',
      };

      authService.googleLogin.mockRejectedValue(
        new UnauthorizedException('Invalid Google ID token'),
      );

      await expect(controller.googleAuth(googleAuthDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should pass sessionToken to googleLogin for onboarding linking', async () => {
      const googleAuthDto: GoogleAuthDto = {
        idToken: 'google-id-token',
        sessionToken: 'onboard-sess-uuid',
      };

      authService.googleLogin.mockResolvedValue(mockAuthResponse);

      await controller.googleAuth(googleAuthDto);

      expect(authService.googleLogin).toHaveBeenCalledWith(
        'google-id-token',
        undefined,
        'onboard-sess-uuid',
      );
    });
  });

  describe('appleAuth', () => {
    it('should handle Apple Sign In successfully', async () => {
      const appleAuthDto: AppleAuthDto = {
        idToken: 'apple-id-token',
        displayName: 'Apple User',
      };

      authService.appleLogin.mockResolvedValue(mockAuthResponse);

      const result = await controller.appleAuth(appleAuthDto);

      expect(authService.appleLogin).toHaveBeenCalledWith(
        appleAuthDto.idToken,
        appleAuthDto.displayName,
        appleAuthDto.sessionToken,
      );
      expect(result).toEqual(mockAuthResponse);
    });

    it('should handle Apple Sign In without displayName', async () => {
      const appleAuthDto: AppleAuthDto = {
        idToken: 'apple-id-token',
      };

      authService.appleLogin.mockResolvedValue(mockAuthResponse);

      const result = await controller.appleAuth(appleAuthDto);

      expect(authService.appleLogin).toHaveBeenCalledWith(appleAuthDto.idToken, undefined, undefined);
      expect(result).toEqual(mockAuthResponse);
    });

    it('should throw UnauthorizedException with invalid Apple ID token', async () => {
      const appleAuthDto: AppleAuthDto = {
        idToken: 'invalid-token',
      };

      authService.appleLogin.mockRejectedValue(
        new UnauthorizedException('Invalid Apple ID token'),
      );

      await expect(controller.appleAuth(appleAuthDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should refresh tokens successfully', async () => {
      const refreshDto: RefreshTokenDto = {
        refreshToken: 'valid-refresh-token',
      };

      authService.refreshTokens.mockResolvedValue(mockAuthResponse);

      const result = await controller.refresh(refreshDto);

      expect(authService.refreshTokens).toHaveBeenCalledWith(refreshDto.refreshToken);
      expect(result).toEqual(mockAuthResponse);
      expect(result.accessToken).toBe('access-token');
    });

    it('should throw UnauthorizedException with invalid refresh token', async () => {
      const refreshDto: RefreshTokenDto = {
        refreshToken: 'invalid-token',
      };

      authService.refreshTokens.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      await expect(controller.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException with expired refresh token', async () => {
      const refreshDto: RefreshTokenDto = {
        refreshToken: 'expired-token',
      };

      authService.refreshTokens.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      await expect(controller.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      authService.logout.mockResolvedValue(undefined);

      const result = await controller.logout(mockUser);

      expect(authService.logout).toHaveBeenCalledWith(mockUser.id);
      expect(result).toBeUndefined();
    });

    it('should handle logout for user with multiple sessions', async () => {
      authService.logout.mockResolvedValue(undefined);

      await controller.logout(mockUser);

      expect(authService.logout).toHaveBeenCalledWith(mockUser.id);
      expect(authService.logout).toHaveBeenCalledTimes(1);
    });
  });
});
