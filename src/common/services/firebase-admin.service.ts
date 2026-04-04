import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { AppConfiguration } from '../../config/app-configuration';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);

  constructor(private configService: ConfigService<AppConfiguration>) {}

  onModuleInit() {
    const projectId = this.configService.get('firebase.projectId', { infer: true });
    const clientEmail = this.configService.get('firebase.clientEmail', { infer: true });
    const privateKey = this.configService
      .get('firebase.privateKey', { infer: true })
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase credentials missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY required',
      );
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
