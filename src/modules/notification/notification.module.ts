import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { FirebaseService } from './firebase.service';
import { DeviceToken } from '../../database/entities/device-token.entity';

/**
 * Notification module for push notifications via Firebase FCM
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
  controllers: [NotificationController],
  providers: [NotificationService, FirebaseService],
  exports: [NotificationService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NotificationModule {}
