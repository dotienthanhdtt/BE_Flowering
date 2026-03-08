import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as appleSignin from 'apple-signin-auth';
import { AppConfiguration } from '../../../config/app-configuration';

export interface AppleUser {
  email: string;
  providerId: string;
}

@Injectable()
export class AppleStrategy {
  constructor(private configService: ConfigService<AppConfiguration>) {}

  async validate(idToken: string): Promise<AppleUser> {
    try {
      const payload = await appleSignin.verifyIdToken(idToken, {
        audience: this.configService.get('oauth.apple.clientId', { infer: true }),
        ignoreExpiration: false,
      });

      if (!payload.email) {
        throw new UnauthorizedException('Apple account must have a verified email');
      }

      return {
        email: payload.email,
        providerId: payload.sub,
      };
    } catch {
      throw new UnauthorizedException('Invalid Apple ID token');
    }
  }
}
