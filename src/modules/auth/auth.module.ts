import { Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { AppleStrategy } from './strategies/apple.strategy';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { AppConfiguration } from '../../config/app-configuration';

// Conditionally provide GoogleStrategy only when credentials are configured
const googleStrategyProvider: Provider = {
  provide: GoogleStrategy,
  useFactory: (configService: ConfigService<AppConfiguration>) => {
    const clientId = configService.get('oauth.google.clientId', { infer: true });
    const clientSecret = configService.get('oauth.google.clientSecret', { infer: true });

    if (!clientId || !clientSecret) {
      // Return null - Google OAuth is optional
      return null;
    }
    return new GoogleStrategy(configService);
  },
  inject: [ConfigService],
};

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfiguration>) => ({
        secret: configService.get('jwt.secret', { infer: true }),
        signOptions: {
          expiresIn: configService.get('jwt.expiresIn', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, googleStrategyProvider, AppleStrategy],
  exports: [AuthService, JwtStrategy],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
