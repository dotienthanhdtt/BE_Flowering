---
phase: 1
title: "Firebase Admin SDK Initialization"
status: ready
priority: high
effort: 30m
---

# Phase 1: Firebase Admin SDK Initialization

## Context Links
- [Plan overview](plan.md)
- [Firebase config](../../src/config/app-configuration.ts) — lines 47-51, 99-104
- [Auth module](../../src/modules/auth/auth.module.ts)

## Overview

Create a Firebase initialization service that initializes `firebase-admin` once at app startup using existing config values.

## Key Insights

- `firebase-admin` v13.6.0 already in `package.json`
- Firebase config already defined in `app-configuration.ts` (projectId, clientEmail, privateKey)
- No Firebase initialization exists anywhere in the codebase yet
- Keep it simple: a single injectable service, not a separate module

## Requirements

- Initialize Firebase Admin SDK with service account credentials from config
- Fail-fast if Firebase credentials are missing (throw on module init)
- Expose `firebase-admin.auth()` for token verification
- Singleton — only one Firebase app instance

## Related Code Files

**Modify:**
- `src/config/app-configuration.ts` — no changes needed (config already exists)

**Create:**
- `src/common/services/firebase-admin.service.ts` — Firebase init + auth() accessor

## Implementation Steps

1. Create `src/common/services/firebase-admin.service.ts`:
   ```typescript
   import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
   import { ConfigService } from '@nestjs/config';
   import * as admin from 'firebase-admin';
   import { AppConfiguration } from '@config/app-configuration';

   @Injectable()
   export class FirebaseAdminService implements OnModuleInit {
     private readonly logger = new Logger(FirebaseAdminService.name);

     constructor(private configService: ConfigService<AppConfiguration>) {}

     onModuleInit() {
       const projectId = this.configService.get('firebase.projectId', { infer: true });
       const clientEmail = this.configService.get('firebase.clientEmail', { infer: true });
       const privateKey = this.configService.get('firebase.privateKey', { infer: true })?.replace(/\\n/g, '\n');

       if (!projectId || !clientEmail || !privateKey) {
         throw new Error('Firebase credentials missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY required');
       }

       if (!admin.apps.length) {
         admin.initializeApp({
           credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
         });
       }

       this.logger.log('Firebase Admin SDK initialized');
     }

     get auth() {
       return admin.auth();
     }
   }
   ```

2. Register in `AuthModule` providers (phase 3 handles this)

## Todo List

- [ ] Create `firebase-admin.service.ts`
- [ ] Verify build compiles: `npm run build`

## Success Criteria

- `FirebaseAdminService` initializes without error when env vars are set
- Service is injectable and exposes `auth` getter
- Build passes

## Risk Assessment

- **Private key newlines**: Railway/Docker may escape `\n` — the `replace(/\\n/g, '\n')` handles this
- **Missing env vars**: Fail-fast with clear error message prevents silent failures
