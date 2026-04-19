import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { AiConversation, AiConversationType } from '../../database/entities/ai-conversation.entity';
import { PasswordReset } from '../../database/entities/password-reset.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { RegisterDto, LoginDto, AuthResponseDto, UserResponseDto, FirebaseAuthDto } from './dto';
import { FirebaseTokenStrategy, OAuthProvider } from './strategies/firebase-token.strategy';
import { EmailService } from '../email/email.service';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface OAuthProviderUser {
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  providerId: string;
  displayName?: string;
  avatarUrl?: string;
  phoneNumber?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private firebaseTokenStrategy: FirebaseTokenStrategy,
    private emailService: EmailService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(AiConversation)
    private conversationRepository: Repository<AiConversation>,
    @InjectRepository(PasswordReset)
    private passwordResetRepository: Repository<PasswordReset>,
    @InjectRepository(UserLanguage)
    private userLanguageRepository: Repository<UserLanguage>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = this.userRepository.create({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
      authProvider: 'email',
    });

    await this.userRepository.save(user);

    if (dto.conversationId) {
      await this.linkOnboardingSession(user.id, dto.conversationId);
    }

    return this.generateTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (dto.conversationId) {
      await this.linkOnboardingSession(user.id, dto.conversationId);
    }

    return this.generateTokens(user);
  }

  async firebaseLogin(dto: FirebaseAuthDto): Promise<AuthResponseDto> {
    const firebaseUser = await this.firebaseTokenStrategy.validate(dto.idToken);
    const providerUser: OAuthProviderUser = {
      firebaseUid: firebaseUser.firebaseUid,
      email: firebaseUser.email,
      emailVerified: firebaseUser.emailVerified,
      providerId: firebaseUser.providerId,
      displayName: dto.displayName ?? firebaseUser.displayName,
      avatarUrl: dto.avatarUrl ?? firebaseUser.avatarUrl,
      phoneNumber: dto.phoneNumber,
    };
    return this.oauthLogin(firebaseUser.provider, providerUser, dto.conversationId);
  }

  /**
   * Unified OAuth login: find by provider-specific column, auto-link on email match, or create new user.
   * Google and Apple both verify emails, so auto-linking is safe.
   */
  private async oauthLogin(
    provider: OAuthProvider,
    providerUser: OAuthProviderUser,
    conversationId?: string,
  ): Promise<AuthResponseDto> {
    const providerColumn = provider === 'google' ? 'googleProviderId' : 'appleProviderId';

    // 1. Find by provider-specific indexed column (O(1))
    let user = await this.userRepository.findOne({
      where: { [providerColumn]: providerUser.providerId },
    });

    if (user) {
      // Update profile fields that may have changed (e.g. Google avatar, name, email verification)
      const profileUpdate: Partial<User> = {};
      if (providerUser.displayName && !user.displayName) profileUpdate.displayName = providerUser.displayName;
      if (providerUser.avatarUrl && providerUser.avatarUrl !== user.avatarUrl) profileUpdate.avatarUrl = providerUser.avatarUrl;
      if (providerUser.firebaseUid && !user.firebaseUid) profileUpdate.firebaseUid = providerUser.firebaseUid;
      if (providerUser.emailVerified && !user.emailVerified) profileUpdate.emailVerified = true;
      if (providerUser.phoneNumber && providerUser.phoneNumber !== user.phoneNumber) profileUpdate.phoneNumber = providerUser.phoneNumber;

      if (Object.keys(profileUpdate).length > 0) {
        await this.userRepository.update({ id: user.id }, profileUpdate);
        user = { ...user, ...profileUpdate };
      }
    } else {
      // 2. Find by email — auto-link if matched, create if not
      const existingEmailUser = await this.userRepository.findOne({
        where: { email: providerUser.email },
      });

      if (existingEmailUser) {
        // Auto-link: attach provider + Firebase UID + update profile
        const update: Partial<User> = {
          [providerColumn]: providerUser.providerId,
          firebaseUid: providerUser.firebaseUid,
          emailVerified: providerUser.emailVerified,
          ...(providerUser.displayName && !existingEmailUser.displayName ? { displayName: providerUser.displayName } : {}),
          ...(providerUser.avatarUrl ? { avatarUrl: providerUser.avatarUrl } : {}),
          ...(providerUser.phoneNumber ? { phoneNumber: providerUser.phoneNumber } : {}),
        };
        await this.userRepository.update({ id: existingEmailUser.id }, update);
        user = { ...existingEmailUser, ...update };
      } else {
        // New user
        user = this.userRepository.create({
          email: providerUser.email,
          emailVerified: providerUser.emailVerified,
          displayName: providerUser.displayName,
          avatarUrl: providerUser.avatarUrl,
          phoneNumber: providerUser.phoneNumber,
          authProvider: provider,
          providerId: providerUser.providerId,
          firebaseUid: providerUser.firebaseUid,
          [providerColumn]: providerUser.providerId,
        });
        await this.userRepository.save(user);
      }
    }

    if (conversationId) {
      await this.linkOnboardingSession(user.id, conversationId);
    }

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    // Composite format: {tokenId}:{secret} — tokenId is the entity UUID PK (O(1) lookup)
    const separatorIndex = refreshToken.indexOf(':');
    if (separatorIndex === -1) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenId = refreshToken.substring(0, separatorIndex);
    const secret = refreshToken.substring(separatorIndex + 1);

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!tokenId || !secret || !uuidPattern.test(tokenId)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Single indexed lookup by PK — O(1) instead of O(n) scan
    const storedToken = await this.refreshTokenRepository.findOne({
      where: { id: tokenId, revoked: false },
      relations: ['user'],
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const isValid = await bcrypt.compare(secret, storedToken.tokenHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token
    storedToken.revoked = true;
    await this.refreshTokenRepository.save(storedToken);

    return this.generateTokens(storedToken.user);
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokenRepository.update({ userId, revoked: false }, { revoked: true });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    // Rate limit FIRST by email — before user lookup to prevent enumeration
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.passwordResetRepository.count({
      where: { email, createdAt: MoreThan(oneHourAgo) },
    });
    if (recentCount >= 3) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.userRepository.findOne({ where: { email } });

    // Always generate OTP + save record to prevent timing/rate-limit side-channels
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = this.sha256(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // +10min

    await this.passwordResetRepository.save(
      this.passwordResetRepository.create({ email, otpHash, expiresAt }),
    );

    // Only send email if user exists — but always do the DB write above
    if (user) {
      try {
        await this.emailService.sendOtp(email, otp);
      } catch (error) {
        this.logger.warn('Failed to send OTP email', { email: this.maskEmail(email), error });
      }
    }

    // Always return identical response regardless of email existence
    return { message: 'If that email is registered, you will receive an OTP' };
  }

  async verifyOtp(email: string, otp: string): Promise<{ resetToken: string }> {
    const record = await this.passwordResetRepository.findOne({
      where: { email, used: false, expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    if (!record) throw new BadRequestException('Invalid or expired OTP');

    record.attempts += 1;
    if (record.attempts > 5) {
      await this.passwordResetRepository.save(record);
      throw new BadRequestException('Too many attempts');
    }

    if (record.otpHash !== this.sha256(otp)) {
      await this.passwordResetRepository.save(record);
      throw new BadRequestException('Invalid or expired OTP');
    }

    const resetToken = crypto.randomUUID();
    record.resetTokenHash = this.sha256(resetToken);
    record.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // +15min
    await this.passwordResetRepository.save(record);

    return { resetToken };
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.sha256(resetToken);
    // Query by hash only; check used/expiry separately for proper error differentiation
    const record = await this.passwordResetRepository.findOne({
      where: { resetTokenHash: tokenHash },
    });

    if (!record) throw new BadRequestException('Invalid or expired reset token');
    if (record.used) throw new UnauthorizedException('Token already used');
    if (!record.resetTokenExpiresAt || record.resetTokenExpiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.userRepository.findOne({ where: { email: record.email } });
    if (!user) throw new NotFoundException('User not found');

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.save(user);

    record.used = true;
    await this.passwordResetRepository.save(record);

    // Revoke all refresh tokens — force re-login on all devices
    await this.refreshTokenRepository.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }

  /**
   * Link anonymous onboarding conversation to a user account.
   * Best-effort: logs warning on failure, never throws.
   */
  private async linkOnboardingSession(userId: string, conversationId: string): Promise<void> {
    let conversation: AiConversation | null = null;
    try {
      // Load conversation for languageId — filtered by ANONYMOUS type acts as a trust check
      conversation = await this.conversationRepository.findOne({
        where: { id: conversationId, type: AiConversationType.ANONYMOUS },
      });
      if (!conversation) {
        this.logger.warn(`No anonymous onboarding session found for id: ${conversationId}`);
        return;
      }

      // Atomic conditional update — if affected=0, another auth flow won the race
      // OR this conversation was already claimed by a different user. Either way,
      // we must NOT bootstrap this user's language from a conversation we didn't own.
      const result = await this.conversationRepository.update(
        { id: conversationId, type: AiConversationType.ANONYMOUS },
        { userId, type: AiConversationType.AUTHENTICATED },
      );
      if (result.affected === 0) {
        this.logger.warn(
          `Onboarding session already linked — skipping bootstrap for conversationId: ${conversationId}`,
        );
        return;
      }
    } catch (error) {
      this.logger.warn('Failed to link onboarding session', { conversationId, error });
      return;
    }

    // Bootstrap user_languages in a separate try block so its failures are
    // distinguishable in logs AND don't leave the conversation-link rolled back.
    try {
      await this.bootstrapUserLanguage(userId, conversation.languageId);
    } catch (error) {
      this.logger.warn('Failed to bootstrap user language from onboarding', {
        conversationId,
        userId,
        languageId: conversation.languageId,
        error,
      });
    }
  }

  /**
   * Idempotently create or reactivate the learner's UserLanguage row based on the
   * onboarding conversation's language. Mutual exclusivity: all other user_languages
   * rows for this user are deactivated first. Wrapped in a transaction so a partial
   * failure cannot leave the user with zero active languages.
   */
  private async bootstrapUserLanguage(userId: string, languageId: string): Promise<void> {
    await this.userLanguageRepository.manager.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserLanguage);
      const existing = await repo.findOne({ where: { userId, languageId } });
      await repo.update({ userId, isActive: true }, { isActive: false });
      if (existing) {
        await repo.update(existing.id, { isActive: true });
      } else {
        await repo.save(repo.create({ userId, languageId, isActive: true }));
      }
    });
  }

  private async generateTokens(user: User): Promise<AuthResponseDto> {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    // Composite token: {tokenId}:{secret} — store hash of secret only
    // tokenId is used as entity PK for O(1) lookup during refresh
    const tokenId = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const rawRefreshToken = `${tokenId}:${secret}`;
    const tokenHash = await bcrypt.hash(secret, 10);

    const refreshTokenEntity = this.refreshTokenRepository.create({
      id: tokenId,
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    });

    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: this.mapToUserDto(user),
    };
  }

  private mapToUserDto(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified ?? false,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      phoneNumber: user.phoneNumber,
      authProvider: user.authProvider,
    };
  }
}
