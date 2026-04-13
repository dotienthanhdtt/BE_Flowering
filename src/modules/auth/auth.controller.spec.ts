import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenDto, FirebaseAuthDto, AuthResponseDto } from './dto';
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
      emailVerified: false,
      displayName: 'Test User',
      avatarUrl: undefined,
      authProvider: 'email',
    },
  };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: false,
    displayName: 'Test User',
    passwordHash: 'hashed',
    authProvider: 'email',
    providerId: undefined,
    googleProviderId: undefined,
    appleProviderId: undefined,
    firebaseUid: undefined,
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
            firebaseLogin: jest.fn(),
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

  describe('register (disabled)', () => {
    it('should throw 410 Gone', () => {
      expect(() => controller.register()).toThrow(HttpException);
      try {
        controller.register();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE);
      }
    });

    it('should not call authService', () => {
      expect(() => controller.register()).toThrow();
    });
  });

  describe('login (disabled)', () => {
    it('should throw 410 Gone', () => {
      expect(() => controller.login()).toThrow(HttpException);
      try {
        controller.login();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE);
      }
    });
  });

  describe('forgotPassword (disabled)', () => {
    it('should throw 410 Gone', () => {
      expect(() => controller.forgotPassword()).toThrow(HttpException);
      try {
        controller.forgotPassword();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE);
      }
    });
  });

  describe('verifyOtp (disabled)', () => {
    it('should throw 410 Gone', () => {
      expect(() => controller.verifyOtp()).toThrow(HttpException);
      try {
        controller.verifyOtp();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE);
      }
    });
  });

  describe('resetPassword (disabled)', () => {
    it('should throw 410 Gone', () => {
      expect(() => controller.resetPassword()).toThrow(HttpException);
      try {
        controller.resetPassword();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE);
      }
    });
  });

  describe('firebaseAuth (POST /auth/firebase)', () => {
    it('should sign in with Firebase ID token successfully', async () => {
      const firebaseAuthDto: FirebaseAuthDto = {
        idToken: 'firebase-id-token',
        displayName: 'Firebase User',
      };

      authService.firebaseLogin.mockResolvedValue(mockAuthResponse);

      const result = await controller.firebaseAuth(firebaseAuthDto);

      expect(authService.firebaseLogin).toHaveBeenCalledWith(firebaseAuthDto);
      expect(result).toEqual(mockAuthResponse);
    });

    it('should throw UnauthorizedException with invalid Firebase ID token', async () => {
      const firebaseAuthDto: FirebaseAuthDto = {
        idToken: 'invalid-token',
      };

      authService.firebaseLogin.mockRejectedValue(
        new UnauthorizedException('Invalid Firebase ID token'),
      );

      await expect(controller.firebaseAuth(firebaseAuthDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should pass conversationId for onboarding linking', async () => {
      const firebaseAuthDto: FirebaseAuthDto = {
        idToken: 'firebase-id-token',
        conversationId: 'onboard-conv-uuid',
      };

      authService.firebaseLogin.mockResolvedValue(mockAuthResponse);

      await controller.firebaseAuth(firebaseAuthDto);

      expect(authService.firebaseLogin).toHaveBeenCalledWith(firebaseAuthDto);
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
