import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/** Notification payload structure */
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Result from multicast send operation */
export interface MulticastResult {
  successCount: number;
  failureCount: number;
  failedTokens: string[];
}

/**
 * Firebase Admin SDK service for sending push notifications via FCM
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.configService.get<string>('firebase.projectId');
    const clientEmail = this.configService.get<string>('firebase.clientEmail');
    const privateKey = this.configService.get<string>('firebase.privateKey');

    // Only initialize if credentials are provided
    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase credentials not configured, push notifications disabled');
      return;
    }

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        });
      }

      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin SDK initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  /**
   * Check if Firebase is properly initialized
   */
  isInitialized(): boolean {
    return this.messaging !== null;
  }

  /**
   * Send notification to a single device
   */
  async sendToDevice(token: string, notification: NotificationPayload): Promise<string | null> {
    if (!this.messaging) {
      this.logger.warn('Firebase not initialized, skipping notification');
      return null;
    }

    const message: admin.messaging.Message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    try {
      return await this.messaging.send(message);
    } catch (error) {
      this.logger.error(`Failed to send notification to device: ${error}`);
      throw error;
    }
  }

  /**
   * Send notification to multiple devices
   * Returns list of failed tokens for cleanup
   */
  async sendToDevices(
    tokens: string[],
    notification: NotificationPayload,
  ): Promise<MulticastResult> {
    if (!this.messaging) {
      this.logger.warn('Firebase not initialized, skipping multicast notification');
      return { successCount: 0, failureCount: tokens.length, failedTokens: [] };
    }

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, failedTokens: [] };
    }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    try {
      const response = await this.messaging.sendEachForMulticast(message);

      // Collect failed tokens for cleanup
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          // These error codes indicate the token is invalid and should be removed
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        failedTokens,
      };
    } catch (error) {
      this.logger.error(`Failed to send multicast notification: ${error}`);
      throw error;
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(tokens: string[], topic: string): Promise<void> {
    if (!this.messaging) {
      this.logger.warn('Firebase not initialized, skipping topic subscription');
      return;
    }

    try {
      await this.messaging.subscribeToTopic(tokens, topic);
      this.logger.log(`Subscribed ${tokens.length} tokens to topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic: ${error}`);
      throw error;
    }
  }

  /**
   * Send notification to all subscribers of a topic
   */
  async sendToTopic(topic: string, notification: NotificationPayload): Promise<string | null> {
    if (!this.messaging) {
      this.logger.warn('Firebase not initialized, skipping topic notification');
      return null;
    }

    try {
      return await this.messaging.send({
        topic,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data,
      });
    } catch (error) {
      this.logger.error(`Failed to send topic notification: ${error}`);
      throw error;
    }
  }
}
