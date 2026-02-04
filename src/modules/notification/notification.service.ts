import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DeviceToken } from '../../database/entities/device-token.entity';
import { FirebaseService, NotificationPayload } from './firebase.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * Service for managing device tokens and sending push notifications
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepo: Repository<DeviceToken>,
  ) {}

  /**
   * Register a device token for push notifications
   */
  async registerDevice(userId: string, dto: RegisterDeviceDto): Promise<void> {
    // Check if token already exists for this user
    const existing = await this.deviceTokenRepo.findOne({
      where: { fcmToken: dto.token },
    });

    if (existing) {
      // Update existing token (might have changed user or platform)
      await this.deviceTokenRepo.update(existing.id, {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName,
        isActive: true,
      });
    } else {
      // Create new device token
      await this.deviceTokenRepo.save({
        userId,
        fcmToken: dto.token,
        platform: dto.platform,
        deviceName: dto.deviceName,
        isActive: true,
      });
    }

    this.logger.log(`Device registered for user ${userId}: ${dto.platform}`);
  }

  /**
   * Unregister a device token
   */
  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.deviceTokenRepo.delete({ userId, fcmToken: token });
    this.logger.log(`Device unregistered for user ${userId}`);
  }

  /**
   * Send notification to all devices of a user
   */
  async sendToUser(userId: string, notification: NotificationPayload): Promise<void> {
    const devices = await this.deviceTokenRepo.find({
      where: { userId, isActive: true },
    });

    if (devices.length === 0) {
      this.logger.debug(`No active devices for user ${userId}`);
      return;
    }

    const tokens = devices.map((d) => d.fcmToken);
    const result = await this.firebaseService.sendToDevices(tokens, notification);

    // Clean up invalid tokens
    if (result.failedTokens.length > 0) {
      await this.deviceTokenRepo.delete({
        fcmToken: In(result.failedTokens),
      });
      this.logger.log(`Cleaned up ${result.failedTokens.length} invalid FCM tokens`);
    }

    this.logger.debug(
      `Notification sent to user ${userId}: ${result.successCount} success, ${result.failureCount} failed`,
    );
  }

  /**
   * Send lesson reminder notification
   */
  async sendLessonReminder(userId: string, lessonTitle: string): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Time to practice!',
      body: `Continue your "${lessonTitle}" lesson`,
      data: { type: 'lesson_reminder' },
    });
  }

  /**
   * Send streak notification
   */
  async sendStreakNotification(userId: string, streakDays: number): Promise<void> {
    await this.sendToUser(userId, {
      title: `${streakDays} day streak!`,
      body: "Keep it up! Don't break your learning streak.",
      data: { type: 'streak', days: streakDays.toString() },
    });
  }

  /**
   * Send achievement notification
   */
  async sendAchievementNotification(userId: string, achievementName: string): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Achievement Unlocked!',
      body: `You earned: ${achievementName}`,
      data: { type: 'achievement' },
    });
  }
}
