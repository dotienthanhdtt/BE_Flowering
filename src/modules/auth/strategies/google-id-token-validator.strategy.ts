import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AppConfiguration } from '../../../config/app-configuration';

export interface GoogleUser {
  email: string;
  providerId: string;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class GoogleIdTokenStrategy {
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(configService: ConfigService<AppConfiguration>) {
    this.clientId = configService.get('oauth.google.clientId', { infer: true }) ?? '';
    this.client = new OAuth2Client(this.clientId);
  }

  async validate(idToken: string): Promise<GoogleUser> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new UnauthorizedException('Invalid Google ID token');
      }

      // Enforce verified email — required for safe auto-linking
      if (!payload.email_verified || !payload.email) {
        throw new UnauthorizedException('Google account must have a verified email');
      }

      return {
        email: payload.email,
        providerId: payload.sub,
        displayName: payload.name,
        avatarUrl: payload.picture,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }
}
