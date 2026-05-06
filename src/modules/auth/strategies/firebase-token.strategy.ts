import { Injectable, UnauthorizedException } from '@nestjs/common';
import { FirebaseAdminService } from '../../../common/services/firebase-admin.service';

export type OAuthProvider = 'google' | 'apple';

export interface FirebaseAuthUser {
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  providerId: string;
  provider: OAuthProvider;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class FirebaseTokenStrategy {
  constructor(private firebaseAdmin: FirebaseAdminService) {}

  async validate(idToken: string): Promise<FirebaseAuthUser> {
    try {
      const decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken);

      if (!decoded.email || !decoded.email_verified) {
        throw new UnauthorizedException('Account must have a verified email');
      }

      const signInProvider = decoded.firebase.sign_in_provider;
      let provider: OAuthProvider;

      if (signInProvider === 'google.com') {
        provider = 'google';
      } else if (signInProvider === 'apple.com') {
        provider = 'apple';
      } else {
        throw new UnauthorizedException(`Unsupported sign-in provider: ${signInProvider}`);
      }

      // Extract original provider UID from firebase.identities for backward compatibility
      // with existing google_provider_id / apple_provider_id columns
      const identities = decoded.firebase.identities;
      const providerIds = identities[signInProvider] as string[] | undefined;
      const providerId = providerIds?.[0] ?? decoded.uid;

      return {
        firebaseUid: decoded.uid,
        email: decoded.email,
        emailVerified: !!decoded.email_verified,
        providerId,
        provider,
        displayName: decoded.name,
        avatarUrl: decoded.picture,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid Firebase ID token');
    }
  }
}
