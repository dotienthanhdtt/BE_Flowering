import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { SubscriptionDto } from './dto/subscription.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipLanguageContext } from '../../common/decorators/active-language.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for subscription endpoints
 */
@ApiTags('subscriptions')
@ApiBearerAuth('JWT-auth')
@SkipLanguageContext()
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user subscription' })
  async getSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.subscriptionService.getUserSubscription(user.id);
  }
}
