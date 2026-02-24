import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AppleStrategy } from './strategies/apple.strategy';
import { GoogleIdTokenStrategy } from './strategies/google-id-token-validator.strategy';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { AiConversation } from '../../database/entities/ai-conversation.entity';
import { AppConfiguration } from '../../config/app-configuration';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, AiConversation]),
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
  providers: [AuthService, JwtStrategy, AppleStrategy, GoogleIdTokenStrategy],
  exports: [AuthService, JwtStrategy],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
