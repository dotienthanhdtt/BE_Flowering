---
phase: 2
title: "Firebase Token Verification Strategy"
status: completed
priority: high
effort: 45m
completed: 2026-04-04
---

# Phase 2: Firebase Token Verification Strategy

## Context Links
- [Plan overview](plan.md)
- [Current Google strategy](../../src/modules/auth/strategies/google-id-token-validator.strategy.ts)
- [Current Apple strategy](../../src/modules/auth/strategies/apple.strategy.ts)
- [Auth service](../../src/modules/auth/auth.service.ts) — lines 106-133

## Overview

Create a single Firebase token verification strategy that replaces both `GoogleIdTokenStrategy` and `AppleStrategy`. Uses `firebase-admin.auth().verifyIdToken()` which handles both Google and Apple tokens.

## Key Insights

- `DecodedIdToken` from Firebase contains:
  - `uid` — Firebase's own user ID
  - `email`, `email_verified`
  - `firebase.sign_in_provider` — `"google.com"` or `"apple.com"`
  - `firebase.identities` — `{ "google.com": ["original-google-sub"], "apple.com": ["original-apple-sub"] }`
- Original provider UIDs in `firebase.identities` match what's stored in `google_provider_id`/`apple_provider_id` columns — backward compatible
- Both Google and Apple enforce verified emails in current code — Firebase does this inherently

## Requirements

- Single service that verifies any Firebase ID token
- Extract provider type, original provider UID, email, display name, avatar
- Return typed result compatible with existing `OAuthProviderUser` interface
- Throw `UnauthorizedException` on invalid tokens

## Related Code Files

**Create:**
- `src/modules/auth/strategies/firebase-token.strategy.ts`

**Will be removed in Phase 4:**
- `src/modules/auth/strategies/google-id-token-validator.strategy.ts`
- `src/modules/auth/strategies/apple.strategy.ts`

## Implementation Steps

1. Create `src/modules/auth/strategies/firebase-token.strategy.ts`:
   ```typescript
   import { Injectable, UnauthorizedException } from '@nestjs/common';
   import { FirebaseAdminService } from '@common/services/firebase-admin.service';

   export interface FirebaseAuthUser {
     email: string;
     providerId: string;       // Original provider UID (Google sub / Apple sub)
     provider: 'google' | 'apple';
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
         let provider: 'google' | 'apple';

         if (signInProvider === 'google.com') {
           provider = 'google';
         } else if (signInProvider === 'apple.com') {
           provider = 'apple';
         } else {
           throw new UnauthorizedException(`Unsupported sign-in provider: ${signInProvider}`);
         }

         // Extract original provider UID from firebase.identities for backward compatibility
         const identities = decoded.firebase.identities;
         const providerKey = signInProvider; // "google.com" or "apple.com"
         const providerIds = identities[providerKey] as string[] | undefined;
         const providerId = providerIds?.[0] ?? decoded.uid;

         return {
           email: decoded.email,
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
   ```

## Todo List

- [ ] Create `firebase-token.strategy.ts`
- [ ] Verify build compiles: `npm run build`

## Success Criteria

- Single strategy handles both Google and Apple Firebase tokens
- Returns original provider UIDs from `firebase.identities` for DB compatibility
- Rejects unverified emails and unsupported providers
- Build passes

## Risk Assessment

- **`firebase.identities` missing**: Fallback to `decoded.uid` — safe but would create new user instead of linking. In practice, identities are always populated for Google/Apple providers.
- **Provider not google/apple**: Explicit rejection with clear error. Can extend later if needed (YAGNI).
