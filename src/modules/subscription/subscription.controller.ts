import { Controller, Get, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Get current user subscription with RC reconciliation' })
  @ApiHeader({
    name: 'x-client-iap-version',
    description: 'IAP client version. Send "2" to receive raw plan values (e.g. unknown).',
    required: false,
  })
  async getSubscription(
    @CurrentUser() user: User,
    @Headers('x-client-iap-version') iapVersion?: string,
  ): Promise<SubscriptionDto | null> {
    return this.subscriptionService.getSubscriptionWithReconcile(user, iapVersion);
  }
}
