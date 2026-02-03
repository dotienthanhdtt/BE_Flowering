# Phase 03: Auth Module

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | pending |
| Effort | 5h |
| Dependencies | Phase 01, Phase 02 |

Implement authentication with JWT strategy, Google OAuth, Apple OAuth, auth controller endpoints, guards, and decorators.

## Key Insights

- Use `@nestjs/passport` with multiple strategies
- JWT access token (15min) + refresh token (7d) pattern
- Google OAuth first priority (most users), Apple required for iOS
- Store refresh tokens hashed in database

## Requirements

### Functional
- Email/password registration and login
- Google OAuth login
- Apple OAuth login (required for iOS App Store)
- JWT access token generation
- Refresh token rotation
- Logout (invalidate refresh tokens)

### Non-Functional
- Access token: 15 min expiry
- Refresh token: 7 day expiry
- Password: bcrypt with 12 rounds
- Secure httpOnly cookies for refresh tokens (optional)

## Architecture

```
src/modules/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── strategies/
│   ├── jwt.strategy.ts
│   ├── jwt-refresh.strategy.ts
│   ├── google.strategy.ts
│   └── apple.strategy.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── jwt-refresh.guard.ts
│   ├── google-auth.guard.ts
│   └── apple-auth.guard.ts
├── decorators/
│   ├── current-user.decorator.ts
│   └── public.decorator.ts
└── dto/
    ├── register.dto.ts
    ├── login.dto.ts
    ├── auth-response.dto.ts
    └── refresh-token.dto.ts
```

## Related Code Files

### Files to Create
- `src/modules/auth/auth.module.ts`
- `src/modules/auth/auth.controller.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/strategies/jwt.strategy.ts`
- `src/modules/auth/strategies/jwt-refresh.strategy.ts`
- `src/modules/auth/strategies/google.strategy.ts`
- `src/modules/auth/strategies/apple.strategy.ts`
- `src/modules/auth/guards/jwt-auth.guard.ts`
- `src/modules/auth/guards/jwt-refresh.guard.ts`
- `src/modules/auth/guards/google-auth.guard.ts`
- `src/modules/auth/guards/apple-auth.guard.ts`
- `src/modules/auth/decorators/current-user.decorator.ts`
- `src/modules/auth/dto/register.dto.ts`
- `src/modules/auth/dto/login.dto.ts`
- `src/modules/auth/dto/auth-response.dto.ts`
- `src/database/entities/refresh-token.entity.ts`

### Files to Modify
- `src/app.module.ts` - Import AuthModule, set global JwtAuthGuard
- `src/common/decorators/public.decorator.ts` - Already created in Phase 01

## Implementation Steps

### Step 1: Install Auth Dependencies (10min)

```bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt passport-google-oauth20
npm install bcrypt apple-signin-auth
npm install -D @types/passport-jwt @types/passport-google-oauth20 @types/bcrypt
```

### Step 2: Create Auth DTOs (20min)

```typescript
// src/modules/auth/dto/register.dto.ts
export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  displayName?: string;
}

// src/modules/auth/dto/auth-response.dto.ts
export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  user: UserDto;
}
```

### Step 3: Create Refresh Token Entity (15min)

```typescript
// src/database/entities/refresh-token.entity.ts
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'token_hash' })
  tokenHash: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### Step 4: Create JWT Strategy (30min)

```typescript
// src/modules/auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

### Step 5: Create Google OAuth Strategy (30min)

```typescript
// src/modules/auth/strategies/google.strategy.ts
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): Promise<GoogleUser> {
    return {
      email: profile.emails[0].value,
      displayName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
      providerId: profile.id,
    };
  }
}
```

### Step 6: Create Apple OAuth Strategy (45min)

```typescript
// src/modules/auth/strategies/apple.strategy.ts
@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(private configService: ConfigService) {
    // Apple Sign In uses different flow (ID token validation)
  }

  async validate(idToken: string): Promise<AppleUser> {
    const payload = await appleSignin.verifyIdToken(idToken, {
      audience: this.configService.get('APPLE_CLIENT_ID'),
      ignoreExpiration: false,
    });

    return {
      email: payload.email,
      providerId: payload.sub,
    };
  }
}
```

### Step 7: Create Auth Service (60min)

```typescript
// src/modules/auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.userService.create({
      ...dto,
      passwordHash: hashedPassword,
      authProvider: 'email',
    });
    return this.generateTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user);
  }

  async oauthLogin(oauthUser: OAuthUser, provider: string): Promise<AuthResponseDto> {
    let user = await this.userService.findByProviderId(provider, oauthUser.providerId);

    if (!user) {
      user = await this.userService.create({
        email: oauthUser.email,
        displayName: oauthUser.displayName,
        avatarUrl: oauthUser.avatarUrl,
        authProvider: provider,
        providerId: oauthUser.providerId,
      });
    }

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash, revoked: false },
      relations: ['user'],
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke old token
    stored.revoked = true;
    await this.refreshTokenRepo.save(stored);

    return this.generateTokens(stored.user);
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { user: { id: userId } },
      { revoked: true },
    );
  }

  private async generateTokens(user: User): Promise<AuthResponseDto> {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(refreshToken, 10);

    await this.refreshTokenRepo.save({
      tokenHash,
      user,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return {
      accessToken,
      refreshToken,
      user: this.mapToDto(user),
    };
  }
}
```

### Step 8: Create Auth Controller (30min)

```typescript
// src/modules/auth/auth.controller.ts
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register new user with email/password' })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login with email/password' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth' })
  async googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request): Promise<AuthResponseDto> {
    return this.authService.oauthLogin(req.user, 'google');
  }

  @Public()
  @Post('apple')
  @ApiOperation({ summary: 'Apple Sign In with ID token' })
  async appleAuth(@Body() dto: AppleAuthDto): Promise<AuthResponseDto> {
    return this.authService.appleLogin(dto.idToken);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout and invalidate refresh tokens' })
  async logout(@CurrentUser() user: User): Promise<void> {
    return this.authService.logout(user.id);
  }
}
```

### Step 9: Create Guards and Decorators (30min)

```typescript
// src/modules/auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

// src/modules/auth/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

### Step 10: Configure Global Auth Guard (15min)

```typescript
// src/app.module.ts
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
```

## Todo List

- [ ] Install passport and jwt dependencies
- [ ] Create RegisterDto, LoginDto, AuthResponseDto
- [ ] Create RefreshToken entity and migration
- [ ] Implement JwtStrategy
- [ ] Implement JwtRefreshStrategy
- [ ] Implement GoogleStrategy
- [ ] Implement AppleStrategy
- [ ] Create JwtAuthGuard with @Public() support
- [ ] Create GoogleAuthGuard
- [ ] Create AppleAuthGuard
- [ ] Create @CurrentUser() decorator
- [ ] Implement AuthService with all methods
- [ ] Create AuthController with all endpoints
- [ ] Configure global JwtAuthGuard
- [ ] Add environment variables for OAuth
- [ ] Write unit tests for AuthService
- [ ] Test OAuth flows manually

## Success Criteria

- [x] POST /auth/register creates user and returns tokens
- [x] POST /auth/login validates credentials and returns tokens
- [x] GET /auth/google initiates OAuth flow
- [x] POST /auth/apple validates ID token
- [x] POST /auth/refresh rotates tokens
- [x] POST /auth/logout invalidates all refresh tokens
- [x] Protected routes reject invalid/expired tokens
- [x] @Public() routes bypass authentication

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OAuth callback URL mismatch | Medium | High | Document exact URLs in setup |
| Apple Sign In complexity | Medium | Medium | Thorough testing, Apple docs |
| Refresh token leakage | Low | High | Hash tokens, secure storage |

## Security Considerations

- Passwords hashed with bcrypt (12 rounds)
- Refresh tokens hashed before storage
- Access tokens short-lived (15min)
- Refresh tokens rotated on each use
- Failed login attempts should be rate-limited (add later)
- OAuth state parameter for CSRF protection
