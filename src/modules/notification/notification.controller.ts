import { Controller, Post, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for push notification device management
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('devices')
  @ApiOperation({ summary: 'Register device for push notifications' })
  async registerDevice(
    @CurrentUser() user: User,
    @Body() dto: RegisterDeviceDto,
  ): Promise<{ message: string }> {
    await this.notificationService.registerDevice(user.id, dto);
    return { message: 'Device registered successfully' };
  }

  @Delete('devices/:token')
  @ApiOperation({ summary: 'Unregister device from push notifications' })
  async unregisterDevice(
    @CurrentUser() user: User,
    @Param('token') token: string,
  ): Promise<{ message: string }> {
    await this.notificationService.unregisterDevice(user.id, token);
    return { message: 'Device unregistered successfully' };
  }
}
