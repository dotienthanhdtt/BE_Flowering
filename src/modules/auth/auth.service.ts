import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { AiConversation, AiConversationType } from '../../database/entities/ai-conversation.entity';
import { RegisterDto, LoginDto, AuthResponseDto, UserResponseDto } from './dto';
import { AppleStrategy } from './strategies/apple.strategy';
import { GoogleIdTokenStrategy } from './strategies/google-id-token-validator.strategy';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

type OAuthProvider = 'google' | 'apple';

interface OAuthProviderUser {
  email: string;
  providerId: string;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private appleStrategy: AppleStrategy,
    private googleIdTokenStrategy: GoogleIdTokenStrategy,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(AiConversation)
    private conversationRepository: Repository<AiConversation>,
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

    if (dto.sessionToken) {
      await this.linkOnboardingSession(user.id, dto.sessionToken);
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

    if (dto.sessionToken) {
      await this.linkOnboardingSession(user.id, dto.sessionToken);
    }

    return this.generateTokens(user);
  }

  async googleLogin(idToken: string, displayName?: string, sessionToken?: string): Promise<AuthResponseDto> {
    const googleUser = await this.googleIdTokenStrategy.validate(idToken);
    const providerUser: OAuthProviderUser = {
      email: googleUser.email,
      providerId: googleUser.providerId,
      displayName: displayName ?? googleUser.displayName,
      avatarUrl: googleUser.avatarUrl,
    };
    return this.oauthLogin('google', providerUser, sessionToken);
  }

  async appleLogin(idToken: string, displayName?: string, sessionToken?: string): Promise<AuthResponseDto> {
    const appleUser = await this.appleStrategy.validate(idToken);
    const providerUser: OAuthProviderUser = {
      email: appleUser.email,
      providerId: appleUser.providerId,
      displayName,
    };
    return this.oauthLogin('apple', providerUser, sessionToken);
  }

  /**
   * Unified OAuth login: find by provider-specific column, auto-link on email match, or create new user.
   * Google and Apple both verify emails, so auto-linking is safe.
   */
  private async oauthLogin(
    provider: OAuthProvider,
    providerUser: OAuthProviderUser,
    sessionToken?: string,
  ): Promise<AuthResponseDto> {
    const providerColumn = provider === 'google' ? 'googleProviderId' : 'appleProviderId';

    // 1. Find by provider-specific indexed column (O(1))
    let user = await this.userRepository.findOne({
      where: { [providerColumn]: providerUser.providerId },
    });

    if (!user) {
      // 2. Find by email — auto-link if matched, create if not
      const existingEmailUser = await this.userRepository.findOne({
        where: { email: providerUser.email },
      });

      if (existingEmailUser) {
        // Auto-link: attach this provider to the existing account using typed update
        const update =
          provider === 'google'
            ? { googleProviderId: providerUser.providerId }
            : { appleProviderId: providerUser.providerId };
        await this.userRepository.update({ id: existingEmailUser.id }, update);
        user = { ...existingEmailUser, ...update };
      } else {
        // New user
        user = this.userRepository.create({
          email: providerUser.email,
          displayName: providerUser.displayName,
          avatarUrl: providerUser.avatarUrl,
          authProvider: provider,
          providerId: providerUser.providerId,
          [providerColumn]: providerUser.providerId,
        });
        await this.userRepository.save(user);
      }
    }

    if (sessionToken) {
      await this.linkOnboardingSession(user.id, sessionToken);
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

  /**
   * Link anonymous onboarding conversation to a user account.
   * Best-effort: logs warning on failure, never throws.
   */
  private async linkOnboardingSession(userId: string, sessionToken: string): Promise<void> {
    try {
      const result = await this.conversationRepository.update(
        { sessionToken, type: AiConversationType.ANONYMOUS },
        { userId, sessionToken: null, type: AiConversationType.AUTHENTICATED },
      );
      if (result.affected === 0) {
        this.logger.warn(`No anonymous onboarding session found for token: ${sessionToken}`);
      }
    } catch (error) {
      this.logger.warn('Failed to link onboarding session', { sessionToken, error });
    }
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
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }
}
