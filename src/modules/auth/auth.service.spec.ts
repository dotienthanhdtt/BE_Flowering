import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { AiConversation } from '../../database/entities/ai-conversation.entity';
import { PasswordReset } from '../../database/entities/password-reset.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { RegisterDto, LoginDto, FirebaseAuthDto } from './dto';
import { FirebaseTokenStrategy, FirebaseAuthUser } from './strategies/firebase-token.strategy';
import { EmailService } from '../email/email.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let conversationRepository: jest.Mocked<{ update: jest.Mock; findOne: jest.Mock }>;
  let userLanguageRepository: jest.Mocked<{ findOne: jest.Mock; update: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock }>;
  let jwtService: jest.Mocked<JwtService>;
  let firebaseTokenStrategy: jest.Mocked<FirebaseTokenStrategy>;
  let passwordResetRepository: jest.Mocked<{ count: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock }>;
  let emailService: jest.Mocked<{ sendOtp: jest.Mock }>;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: false,
    passwordHash: 'hashed-password',
    displayName: 'Test User',
    avatarUrl: undefined,
    phoneNumber: undefined,
    authProvider: 'email',
    providerId: undefined,
    googleProviderId: undefined,
    appleProviderId: undefined,
    firebaseUid: undefined,
    nativeLanguageId: undefined,
    isAdmin: false,
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
          provide: FirebaseTokenStrategy,
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
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AiConversation),
          useValue: {
            update: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserLanguage),
          useValue: (() => {
            const repo: any = {
              findOne: jest.fn(),
              update: jest.fn(),
              create: jest.fn().mockImplementation((dto) => dto),
              save: jest.fn(),
              find: jest.fn().mockResolvedValue([]),
            };
            repo.manager = {
              // Invoke callback with a mock EntityManager whose getRepository returns repo itself
              transaction: jest.fn((cb: (mgr: { getRepository: () => typeof repo }) => Promise<unknown>) =>
                cb({ getRepository: () => repo }),
              ),
            };
            return repo;
          })(),
        },
        {
          provide: getRepositoryToken(PasswordReset),
          useValue: {
            count: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOtp: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
    conversationRepository = module.get(getRepositoryToken(AiConversation));
    jwtService = module.get(JwtService);
    firebaseTokenStrategy = module.get(FirebaseTokenStrategy);
    passwordResetRepository = module.get(getRepositoryToken(PasswordReset));
    emailService = module.get(EmailService);
    userLanguageRepository = module.get(getRepositoryToken(UserLanguage));
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

      const userWithHash = { ...mockUser, passwordHash: 'hashed-password' };
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

  describe('firebaseLogin', () => {
    const googleFirebaseUser: FirebaseAuthUser = {
      firebaseUid: 'firebase-uid-google-123',
      providerId: 'google-sub-123',
      email: 'google@example.com',
      emailVerified: true,
      provider: 'google',
      displayName: 'Google User',
      avatarUrl: 'https://avatar.url',
    };

    const appleFirebaseUser: FirebaseAuthUser = {
      firebaseUid: 'firebase-uid-apple-456',
      providerId: 'apple-123',
      email: 'apple@example.com',
      emailVerified: true,
      provider: 'apple',
    };

    it('should create new user on first-time Google Firebase login', async () => {
      firebaseTokenStrategy.validate.mockResolvedValue(googleFirebaseUser);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.firebaseLogin({ idToken: 'firebase-id-token', displayName: 'Google User' } as FirebaseAuthDto);

      expect(firebaseTokenStrategy.validate).toHaveBeenCalledWith('firebase-id-token');
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { googleProviderId: googleFirebaseUser.providerId },
      });
      expect(userRepository.create).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should login existing Google user by provider ID', async () => {
      const existingGoogleUser = { ...mockUser, googleProviderId: 'google-sub-123' };
      firebaseTokenStrategy.validate.mockResolvedValue(googleFirebaseUser);
      userRepository.findOne.mockResolvedValue(existingGoogleUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.firebaseLogin({ idToken: 'firebase-id-token' } as FirebaseAuthDto);

      expect(userRepository.create).not.toHaveBeenCalled();
      expect(result.user.email).toBe(existingGoogleUser.email);
    });

    it('should auto-link Google account to existing email user', async () => {
      const existingEmailUser = { ...mockUser, authProvider: 'email' };
      firebaseTokenStrategy.validate.mockResolvedValue(googleFirebaseUser);
      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingEmailUser);
      userRepository.update.mockResolvedValue({ affected: 1 } as any);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.firebaseLogin({ idToken: 'firebase-id-token' } as FirebaseAuthDto);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: existingEmailUser.id },
        expect.objectContaining({ googleProviderId: googleFirebaseUser.providerId, firebaseUid: googleFirebaseUser.firebaseUid }),
      );
      expect(userRepository.create).not.toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should create new user for first-time Apple Firebase login', async () => {
      firebaseTokenStrategy.validate.mockResolvedValue(appleFirebaseUser);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.firebaseLogin({ idToken: 'apple-firebase-token', displayName: 'Apple User' } as FirebaseAuthDto);

      expect(firebaseTokenStrategy.validate).toHaveBeenCalledWith('apple-firebase-token');
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { appleProviderId: appleFirebaseUser.providerId },
      });
      expect(result).toHaveProperty('accessToken');
    });

    it('should auto-link Apple account to existing email user', async () => {
      const existingEmailUser = { ...mockUser, authProvider: 'email' };
      firebaseTokenStrategy.validate.mockResolvedValue(appleFirebaseUser);
      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingEmailUser);
      userRepository.update.mockResolvedValue({ affected: 1 } as any);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await service.firebaseLogin({ idToken: 'apple-firebase-token' } as FirebaseAuthDto);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: existingEmailUser.id },
        expect.objectContaining({ appleProviderId: appleFirebaseUser.providerId, firebaseUid: appleFirebaseUser.firebaseUid }),
      );
      expect(result).toHaveProperty('accessToken');
    });

    it('should pass conversationId to onboarding linking', async () => {
      firebaseTokenStrategy.validate.mockResolvedValue(googleFirebaseUser);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
      conversationRepository.findOne.mockResolvedValue({ id: 'conv-tok', languageId: 'lang-en' } as any);
      conversationRepository.update.mockResolvedValue({ affected: 1 } as any);

      await service.firebaseLogin({ idToken: 'firebase-id-token', conversationId: 'conv-tok' } as FirebaseAuthDto);

      expect(conversationRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conv-tok' }),
        expect.objectContaining({ userId: mockUser.id }),
      );
    });
  });

  describe('refreshTokens', () => {
    const tokenId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const secret = 'deadbeef'.repeat(8);
    const compositeToken = `${tokenId}:${secret}`;

    it('should successfully refresh with valid composite token', async () => {
      const storedToken: RefreshToken = {
        id: tokenId,
        tokenHash: 'hashed-secret',
        userId: mockUser.id,
        user: mockUser,
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
        createdAt: new Date(),
      };

      refreshTokenRepository.findOne.mockResolvedValue(storedToken);
      refreshTokenRepository.save.mockResolvedValue(storedToken);
      jwtService.sign.mockReturnValue('new-access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refreshTokens(compositeToken);

      expect(refreshTokenRepository.findOne).toHaveBeenCalledWith({
        where: { id: tokenId, revoked: false },
        relations: ['user'],
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException for malformed token (no colon)', async () => {
      await expect(service.refreshTokens('no-colon-here')).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for token with empty tokenId', async () => {
      await expect(service.refreshTokens(':somesecret')).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for token with empty secret', async () => {
      await expect(service.refreshTokens(`${tokenId}:`)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if tokenId not found in DB', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.refreshTokens(compositeToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if token is expired', async () => {
      const expiredToken: RefreshToken = {
        id: tokenId,
        tokenHash: 'hashed-secret',
        userId: mockUser.id,
        user: mockUser,
        expiresAt: new Date(Date.now() - 1000),
        revoked: false,
        createdAt: new Date(),
      };

      refreshTokenRepository.findOne.mockResolvedValue(expiredToken);

      await expect(service.refreshTokens(compositeToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if secret does not match hash', async () => {
      const storedToken: RefreshToken = {
        id: tokenId,
        tokenHash: 'hashed-secret',
        userId: mockUser.id,
        user: mockUser,
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
        createdAt: new Date(),
      };

      refreshTokenRepository.findOne.mockResolvedValue(storedToken);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.refreshTokens(compositeToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('generateTokens', () => {
    it('should return composite refresh token in uuid:hex format', async () => {
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-secret');

      // Trigger via register (public method)
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'new@example.com',
        password: 'Pass123!',
      });

      // Composite format: uuid (8-4-4-4-12 chars) + ':' + 64-char hex
      expect(result.refreshToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}$/,
      );
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

  describe('register with conversationId (onboarding linking)', () => {
    it('calls linkOnboardingSession after user creation when conversationId provided', async () => {
      const registerDto: RegisterDto = {
        email: 'new@example.com',
        password: 'SecurePass123!',
        displayName: 'New User',
        conversationId: 'conv-tok-123',
      };

      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
      conversationRepository.findOne.mockResolvedValue({ id: 'conv-tok-123', languageId: 'lang-en' } as any);
      conversationRepository.update.mockResolvedValue({ affected: 1 } as any);

      await service.register(registerDto);

      expect(conversationRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conv-tok-123' }),
        expect.objectContaining({ userId: mockUser.id }),
      );
    });

    it('does not call linkOnboardingSession when no conversationId provided', async () => {
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

      await service.register(registerDto);

      expect(conversationRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    const makePasswordReset = (overrides = {}): PasswordReset => ({
      id: 'pr-1',
      email: 'test@example.com',
      otpHash: 'hash',
      resetTokenHash: null,
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
      resetTokenExpiresAt: null,
      used: false,
      createdAt: new Date(),
      ...overrides,
    } as PasswordReset);

    it('returns generic message when user found and OTP sent', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      passwordResetRepository.count.mockResolvedValue(0);
      passwordResetRepository.create.mockImplementation((dto) => ({ ...dto }));
      passwordResetRepository.save.mockResolvedValue(makePasswordReset());
      emailService.sendOtp.mockResolvedValue(undefined);

      const result = await service.forgotPassword('test@example.com');

      expect(result.message).toBe('If that email is registered, you will receive an OTP');
      expect(emailService.sendOtp).toHaveBeenCalled();
    });

    it('returns same generic message when email not registered (no enumeration)', async () => {
      passwordResetRepository.count.mockResolvedValue(0);
      userRepository.findOne.mockResolvedValue(null);
      passwordResetRepository.create.mockImplementation((dto) => ({ ...dto }));
      passwordResetRepository.save.mockResolvedValue(makePasswordReset());

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toBe('If that email is registered, you will receive an OTP');
      expect(passwordResetRepository.save).toHaveBeenCalled();
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });

    it('throws 429 HttpException when >= 3 requests in last hour', async () => {
      passwordResetRepository.count.mockResolvedValue(3);

      await expect(service.forgotPassword('test@example.com')).rejects.toThrow(HttpException);
    });

    it('still returns 200 when SMTP send fails (fire-and-forget)', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      passwordResetRepository.count.mockResolvedValue(0);
      passwordResetRepository.create.mockImplementation((dto) => ({ ...dto }));
      passwordResetRepository.save.mockResolvedValue(makePasswordReset());
      emailService.sendOtp.mockRejectedValue(new Error('SMTP connection refused'));

      const result = await service.forgotPassword('test@example.com');

      expect(result.message).toBe('If that email is registered, you will receive an OTP');
    });
  });

  describe('verifyOtp', () => {
    const makePasswordReset = (overrides = {}): PasswordReset => ({
      id: 'pr-1',
      email: 'test@example.com',
      otpHash: '',
      resetTokenHash: null,
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
      resetTokenExpiresAt: null,
      used: false,
      createdAt: new Date(),
      ...overrides,
    } as PasswordReset);

    it('returns resetToken on valid OTP', async () => {
      const crypto = require('crypto');
      const otp = '123456';
      const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
      const record = makePasswordReset({ otpHash });

      passwordResetRepository.findOne.mockResolvedValue(record);
      passwordResetRepository.save.mockResolvedValue({ ...record, resetTokenHash: 'hash' });

      const result = await service.verifyOtp('test@example.com', otp);

      expect(result).toHaveProperty('resetToken');
      expect(typeof result.resetToken).toBe('string');
    });

    it('throws BadRequestException when no valid record found', async () => {
      passwordResetRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyOtp('test@example.com', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when OTP is wrong', async () => {
      const record = makePasswordReset({ otpHash: 'wrong-hash', attempts: 0 });
      passwordResetRepository.findOne.mockResolvedValue(record);
      passwordResetRepository.save.mockResolvedValue(record);

      await expect(service.verifyOtp('test@example.com', '999999')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when attempts > 5', async () => {
      const record = makePasswordReset({ otpHash: 'any-hash', attempts: 5 });
      passwordResetRepository.findOne.mockResolvedValue(record);
      passwordResetRepository.save.mockResolvedValue(record);

      await expect(service.verifyOtp('test@example.com', '123456')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    const makePasswordReset = (overrides = {}): PasswordReset => ({
      id: 'pr-1',
      email: 'test@example.com',
      otpHash: 'hash',
      resetTokenHash: null,
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
      resetTokenExpiresAt: new Date(Date.now() + 900000),
      used: false,
      createdAt: new Date(),
      ...overrides,
    } as PasswordReset);

    it('resets password, marks record used, revokes refresh tokens', async () => {
      const crypto = require('crypto');
      const resetToken = crypto.randomUUID();
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const record = makePasswordReset({ resetTokenHash: tokenHash });

      passwordResetRepository.findOne.mockResolvedValue(record);
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      passwordResetRepository.save.mockResolvedValue({ ...record, used: true });
      refreshTokenRepository.update.mockResolvedValue({ affected: 1 } as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.resetPassword(resetToken, 'NewPassword123!');

      expect(userRepository.save).toHaveBeenCalled();
      expect(passwordResetRepository.save).toHaveBeenCalledWith(expect.objectContaining({ used: true }));
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: mockUser.id, revoked: false },
        { revoked: true },
      );
    });

    it('throws BadRequestException when reset token not found', async () => {
      passwordResetRepository.findOne.mockResolvedValue(null);

      await expect(service.resetPassword('bad-uuid-token-1234-1234-1234', 'NewPass123!')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when reset token already used', async () => {
      const crypto = require('crypto');
      const resetToken = crypto.randomUUID();
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const record = makePasswordReset({ resetTokenHash: tokenHash, used: true });

      passwordResetRepository.findOne.mockResolvedValue(record);

      await expect(service.resetPassword(resetToken, 'NewPass123!')).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when reset token expired', async () => {
      const crypto = require('crypto');
      const resetToken = crypto.randomUUID();
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const record = makePasswordReset({
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: new Date(Date.now() - 1000), // expired
      });

      passwordResetRepository.findOne.mockResolvedValue(record);

      await expect(service.resetPassword(resetToken, 'NewPass123!')).rejects.toThrow(BadRequestException);
    });
  });

  describe('linkOnboardingSession (via register)', () => {
    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
    });

    it('logs warning when no matching anonymous session found', async () => {
      conversationRepository.findOne.mockResolvedValue(null);
      const loggerSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      await service.register({
        email: 'a@b.com',
        password: 'Pass123!',
        conversationId: 'unknown-conv-id',
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('No anonymous onboarding session found'),
      );
      // No bootstrap should happen when conversation not found
      expect(userLanguageRepository.save).not.toHaveBeenCalled();
    });

    it('logs warning on error and does not throw', async () => {
      conversationRepository.findOne.mockRejectedValue(new Error('DB error'));
      const loggerSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      await expect(
        service.register({
          email: 'a@b.com',
          password: 'Pass123!',
          conversationId: 'conv-id',
        }),
      ).resolves.not.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to link onboarding session',
        expect.objectContaining({ conversationId: 'conv-id' }),
      );
    });
  });

  describe('bootstrapUserLanguage (via linkOnboardingSession)', () => {
    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('access-token');
      refreshTokenRepository.create.mockReturnValue({} as RefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
      conversationRepository.findOne.mockResolvedValue({ id: 'conv-1', languageId: 'lang-es' } as any);
      conversationRepository.update.mockResolvedValue({ affected: 1 } as any);
    });

    const registerWithConv = () =>
      service.register({
        email: 'a@b.com',
        password: 'Pass123!',
        conversationId: 'conv-1',
      });

    it('creates new UserLanguage row when user has none for that language', async () => {
      userLanguageRepository.findOne.mockResolvedValue(null);
      userLanguageRepository.update.mockResolvedValue({ affected: 0 } as any);
      userLanguageRepository.save.mockResolvedValue({ id: 'ul-1' } as any);

      await registerWithConv();

      // Deactivate any existing active row (none here) then create new
      expect(userLanguageRepository.update).toHaveBeenCalledWith(
        { userId: mockUser.id, isActive: true },
        { isActive: false },
      );
      expect(userLanguageRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id, languageId: 'lang-es', isActive: true }),
      );
    });

    it('reactivates existing row instead of inserting duplicate', async () => {
      const existing = { id: 'ul-existing', userId: mockUser.id, languageId: 'lang-es', isActive: false };
      userLanguageRepository.findOne.mockResolvedValue(existing);
      userLanguageRepository.update.mockResolvedValue({ affected: 1 } as any);

      await registerWithConv();

      // Deactivate others first
      expect(userLanguageRepository.update).toHaveBeenCalledWith(
        { userId: mockUser.id, isActive: true },
        { isActive: false },
      );
      // Flip existing row to active
      expect(userLanguageRepository.update).toHaveBeenCalledWith('ul-existing', { isActive: true });
      expect(userLanguageRepository.save).not.toHaveBeenCalled();
    });

    it('deactivates other active languages before activating target', async () => {
      userLanguageRepository.findOne.mockResolvedValue(null);
      userLanguageRepository.update.mockResolvedValue({ affected: 1 } as any);
      userLanguageRepository.save.mockResolvedValue({ id: 'ul-new' } as any);

      await registerWithConv();

      // First update call deactivates all active rows for this user
      const updateCalls = userLanguageRepository.update.mock.calls;
      expect(updateCalls[0]).toEqual([
        { userId: mockUser.id, isActive: true },
        { isActive: false },
      ]);
    });

    it('does not touch user_languages when no conversationId provided', async () => {
      await service.register({
        email: 'a@b.com',
        password: 'Pass123!',
      });

      expect(userLanguageRepository.findOne).not.toHaveBeenCalled();
      expect(userLanguageRepository.update).not.toHaveBeenCalled();
      expect(userLanguageRepository.save).not.toHaveBeenCalled();
    });

    it('swallows bootstrap errors — auth still succeeds', async () => {
      userLanguageRepository.findOne.mockRejectedValue(new Error('user_languages DB error'));
      const loggerSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      const result = await registerWithConv();

      expect(result).toHaveProperty('accessToken');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to bootstrap user language from onboarding',
        expect.objectContaining({ conversationId: 'conv-1', userId: mockUser.id, languageId: 'lang-es' }),
      );
    });

    it('skips bootstrap when conversation was already linked mid-flight (affected=0)', async () => {
      conversationRepository.findOne.mockResolvedValue({ id: 'conv-1', languageId: 'lang-es' } as any);
      conversationRepository.update.mockResolvedValue({ affected: 0 } as any);
      const loggerSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      await registerWithConv();

      expect(userLanguageRepository.findOne).not.toHaveBeenCalled();
      expect(userLanguageRepository.update).not.toHaveBeenCalled();
      expect(userLanguageRepository.save).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('already linked — skipping bootstrap'),
      );
    });
  });
});
