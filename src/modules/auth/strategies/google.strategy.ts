import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { AppConfiguration } from '../../../config/app-configuration';

export interface GoogleUser {
  email: string;
  displayName: string;
  avatarUrl?: string;
  providerId: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService<AppConfiguration>) {
    const clientId = configService.get('oauth.google.clientId', { infer: true });
    const clientSecret = configService.get('oauth.google.clientSecret', { infer: true });
    const callbackUrl = configService.get('oauth.google.callbackUrl', { infer: true });

    // passport-oauth2 requires clientID - throw clear error if missing
    if (!clientId || !clientSecret) {
      throw new Error(
        'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars, or remove GoogleStrategy from AuthModule providers.',
      );
    }

    super({
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: callbackUrl || '',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const user: GoogleUser = {
      email: profile.emails?.[0]?.value ?? '',
      displayName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
      providerId: profile.id,
    };

    done(null, user);
  }
}
