import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { RegisterDto, LoginDto } from './dto';
import { AppleStrategy } from './strategies/apple.strategy';
import { GoogleUser } from './strategies/google.strategy';
import { AppleUser } from './strategies/apple.strategy';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let jwtService: jest.Mocked<JwtService>;
  let appleStrategy: jest.Mocked<AppleStrategy>;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    displayName: 'Test User',
    avatarUrl: undefined,
    authProvider: 'email',
    providerId: undefined,
    nativeLanguageId: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: AppleStrategy,
          useValue: {
            validate: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
    jwtService = module.get(JwtService);
    appleStrategy = module.get(AppleStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register new user', async () => {
      const registerDto: RegisterDto = {
        email: 'new@example.com',
        password: 'SecurePass123!',
        displayName: 'New User',
      };

      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.register(registerDto);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(userRepository.create).toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
    });

    it('should throw ConflictException if email already exists', async () => {
      const registerDto: RegisterDto = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
      };

      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'SecurePass123!',
      };

      const hashedPassword = 'hashed-password';
      const userWithHash = { ...mockUser, passwordHash: hashedPassword };

      userRepository.findOne.mockResolvedValue(userWithHash);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const loginDto: LoginDto = {
        email: 'nonexistent@example.com',
        password: 'SecurePass123!',
      };

      userRepository.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password invalid', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'WrongPassword',
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user has no password hash', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'SecurePass123!',
      };

      const oauthUser = { ...mockUser, passwordHash: undefined };
      userRepository.findOne.mockResolvedValue(oauthUser);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('oauthLogin', () => {
    it('should create new user for first-time Google login', async () => {
      const googleUser: GoogleUser = {
        providerId: 'google-123',
        email: 'google@example.com',
        displayName: 'Google User',
        avatarUrl: 'https://avatar.url',
      };

      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.oauthLogin(googleUser, 'google');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { authProvider: 'google', providerId: googleUser.providerId },
      });
      expect(userRepository.create).toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should login existing OAuth user', async () => {
      const googleUser: GoogleUser = {
        providerId: 'google-123',
        email: 'google@example.com',
        displayName: 'Google User',
        avatarUrl: 'https://avatar.url',
      };

      const existingOAuthUser = { ...mockUser, authProvider: 'google', providerId: 'google-123' };
      userRepository.findOne.mockResolvedValue(existingOAuthUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.oauthLogin(googleUser, 'google');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { authProvider: 'google', providerId: googleUser.providerId },
      });
      expect(userRepository.create).not.toHaveBeenCalled();
      expect(result.user.email).toBe(existingOAuthUser.email);
    });

    it('should throw ConflictException if email exists with different provider', async () => {
      const googleUser: GoogleUser = {
        providerId: 'google-123',
        email: 'test@example.com',
        displayName: 'Google User',
      };

      const existingEmailUser = { ...mockUser, authProvider: 'email' };
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existingEmailUser);

      await expect(service.oauthLogin(googleUser, 'google')).rejects.toThrow(ConflictException);
    });
  });

  describe('appleLogin', () => {
    it('should create new user for first-time Apple login', async () => {
      const appleUser: AppleUser = {
        providerId: 'apple-123',
        email: 'apple@example.com',
      };

      appleStrategy.validate.mockResolvedValue(appleUser);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.appleLogin('apple-id-token', 'Apple User');

      expect(appleStrategy.validate).toHaveBeenCalledWith('apple-id-token');
      expect(userRepository.create).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should login existing Apple user', async () => {
      const appleUser: AppleUser = {
        providerId: 'apple-123',
        email: 'apple@example.com',
      };

      const existingAppleUser = { ...mockUser, authProvider: 'apple', providerId: 'apple-123' };
      appleStrategy.validate.mockResolvedValue(appleUser);
      userRepository.findOne.mockResolvedValue(existingAppleUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.appleLogin('apple-id-token');

      expect(userRepository.create).not.toHaveBeenCalled();
      expect(result.user.email).toBe(existingAppleUser.email);
    });

    it('should throw ConflictException if email exists with different provider', async () => {
      const appleUser: AppleUser = {
        providerId: 'apple-123',
        email: 'test@example.com',
      };

      const existingEmailUser = { ...mockUser, authProvider: 'google' };
      appleStrategy.validate.mockResolvedValue(appleUser);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existingEmailUser);

      await expect(service.appleLogin('apple-id-token')).rejects.toThrow(ConflictException);
    });
  });

  describe('refreshTokens', () => {
    it('should successfully refresh tokens with valid refresh token', async () => {
      const refreshToken = 'valid-refresh-token';
      const hashedToken = 'hashed-token';

      const storedToken: RefreshToken = {
        id: 'token-123',
        tokenHash: hashedToken,
        userId: mockUser.id,
        user: mockUser,
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
        createdAt: new Date(),
      };

      refreshTokenRepository.find.mockResolvedValue([storedToken]);
      refreshTokenRepository.save.mockResolvedValue(storedToken);
      jwtService.sign.mockReturnValue('new-access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refreshTokens(refreshToken);

      expect(refreshTokenRepository.find).toHaveBeenCalledWith({
        where: { revoked: false },
        relations: ['user'],
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException if token not found', async () => {
      const refreshToken = 'invalid-token';

      refreshTokenRepository.find.mockResolvedValue([]);

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if token expired', async () => {
      const refreshToken = 'expired-token';
      const hashedToken = 'hashed-token';

      const expiredToken: RefreshToken = {
        id: 'token-123',
        tokenHash: hashedToken,
        userId: mockUser.id,
        user: mockUser,
        expiresAt: new Date(Date.now() - 1000),
        revoked: false,
        createdAt: new Date(),
      };

      refreshTokenRepository.find.mockResolvedValue([expiredToken]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if token revoked', async () => {
      const refreshToken = 'revoked-token';

      refreshTokenRepository.find.mockResolvedValue([]);

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke all user refresh tokens', async () => {
      const userId = 'user-123';

      refreshTokenRepository.update.mockResolvedValue({} as any);

      await service.logout(userId);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId, revoked: false },
        { revoked: true },
      );
    });
  });
});
