import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { SubscriptionDto } from './dto/subscription.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for subscription endpoints
 */
@ApiTags('subscriptions')
@ApiBearerAuth('JWT-auth')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user subscription' })
  async getSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.subscriptionService.getUserSubscription(user.id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sync subscription with RevenueCat' })
  @ApiOkResponse({ type: SubscriptionDto })
  async syncSubscription(@CurrentUser() user: User): Promise<SubscriptionDto> {
    return this.subscriptionService.syncSubscription(user.id);
  }
}
