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
import { GoogleUser } from './strategies/google.strategy';
import { AppleUser, AppleStrategy } from './strategies/apple.strategy';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export type OAuthUser = GoogleUser | AppleUser;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private appleStrategy: AppleStrategy,
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

  async oauthLogin(oauthUser: OAuthUser, provider: string, sessionToken?: string): Promise<AuthResponseDto> {
    let user = await this.userRepository.findOne({
      where: {
        authProvider: provider,
        providerId: oauthUser.providerId,
      },
    });

    if (!user) {
      // Check if email already exists with different provider
      const existingEmailUser = await this.userRepository.findOne({
        where: { email: oauthUser.email },
      });

      if (existingEmailUser) {
        throw new ConflictException(
          `Email already registered with ${existingEmailUser.authProvider}`,
        );
      }

      user = this.userRepository.create({
        email: oauthUser.email,
        displayName: 'displayName' in oauthUser ? oauthUser.displayName : undefined,
        avatarUrl: 'avatarUrl' in oauthUser ? oauthUser.avatarUrl : undefined,
        authProvider: provider,
        providerId: oauthUser.providerId,
      });

      await this.userRepository.save(user);
    }

    if (sessionToken) {
      await this.linkOnboardingSession(user.id, sessionToken);
    }

    return this.generateTokens(user);
  }

  async appleLogin(idToken: string, displayName?: string, sessionToken?: string): Promise<AuthResponseDto> {
    const appleUser = await this.appleStrategy.validate(idToken);

    let user = await this.userRepository.findOne({
      where: {
        authProvider: 'apple',
        providerId: appleUser.providerId,
      },
    });

    if (!user) {
      const existingEmailUser = await this.userRepository.findOne({
        where: { email: appleUser.email },
      });

      if (existingEmailUser) {
        throw new ConflictException(
          `Email already registered with ${existingEmailUser.authProvider}`,
        );
      }

      user = this.userRepository.create({
        email: appleUser.email,
        displayName,
        authProvider: 'apple',
        providerId: appleUser.providerId,
      });

      await this.userRepository.save(user);
    }

    if (sessionToken) {
      await this.linkOnboardingSession(user.id, sessionToken);
    }

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    const storedTokens = await this.refreshTokenRepository.find({
      where: { revoked: false },
      relations: ['user'],
    });

    let matchedToken: RefreshToken | null = null;

    for (const stored of storedTokens) {
      const isMatch = await bcrypt.compare(refreshToken, stored.tokenHash);
      if (isMatch) {
        matchedToken = stored;
        break;
      }
    }

    if (!matchedToken || matchedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token
    matchedToken.revoked = true;
    await this.refreshTokenRepository.save(matchedToken);

    return this.generateTokens(matchedToken.user);
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

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(refreshToken, 10);

    const refreshTokenEntity = this.refreshTokenRepository.create({
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    });

    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      accessToken,
      refreshToken,
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
