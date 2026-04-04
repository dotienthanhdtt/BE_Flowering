import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { AppConfiguration } from '../../config/app-configuration';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);

  constructor(private configService: ConfigService<AppConfiguration>) {}

  private initialized = false;

  onModuleInit() {
    const projectId = this.configService.get('firebase.projectId', { infer: true });
    const clientEmail = this.configService.get('firebase.clientEmail', { infer: true });
    const privateKey = this.configService
      .get('firebase.privateKey', { infer: true })
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase credentials not configured — POST /auth/firebase will be unavailable');
      return;
    }

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
      }
      this.initialized = true;
      this.logger.log('Firebase Admin SDK initialized');
    } catch (error) {
      this.logger.error('Firebase Admin SDK initialization failed — check FIREBASE_PRIVATE_KEY format', error);
    }
  }

  get auth() {
    if (!this.initialized) {
      throw new Error('Firebase Admin SDK not initialized — check credentials');
    }
    return admin.auth();
  }
}
