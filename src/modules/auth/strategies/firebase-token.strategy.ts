import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
  private readonly logger = new Logger(FirebaseTokenStrategy.name);

  constructor(private firebaseAdmin: FirebaseAdminService) {}

  async validate(idToken: string): Promise<FirebaseAuthUser> {
    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Missing Firebase ID token');
    }
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
      const code = (error as { code?: string; errorInfo?: { code?: string } })?.errorInfo?.code
        ?? (error as { code?: string })?.code;
      const message = (error as Error)?.message;
      this.logger.warn(
        `verifyIdToken failed: code=${code ?? 'unknown'} message=${message ?? 'unknown'}`,
      );
      // Surface the Firebase error code so clients can react (e.g. refresh on expired).
      const reason = code ?? 'verification-failed';
      throw new UnauthorizedException(`Invalid Firebase ID token (${reason})`);
    }
  }
}
