import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../../common/decorators/public-route.decorator';
import { SubscriptionService } from '../subscription.service';
import { RevenueCatWebhookDto } from '../dto/revenuecat-webhook.dto';

/**
 * Controller for RevenueCat webhook endpoint
 * Handles subscription lifecycle events from RevenueCat
 */
@Controller('webhooks')
export class RevenuecatWebhookController {
  private readonly logger = new Logger(RevenuecatWebhookController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('revenuecat')
  @HttpCode(200)
  @ApiOperation({ summary: 'RevenueCat webhook endpoint' })
  @ApiExcludeEndpoint() // Hide from Swagger docs
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhookDto,
  ): Promise<{ status: string }> {
    // Verify webhook authorization using timing-safe comparison
    const expectedSecret = this.configService.get<string>('revenuecat.webhookSecret');
    if (expectedSecret && !this.verifyAuth(authHeader, expectedSecret)) {
      this.logger.warn('Invalid webhook authorization attempt');
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    this.logger.log(
      `Received RevenueCat webhook: ${payload.event.type} for user ${payload.event.app_user_id}`,
    );

    // Respond immediately, process asynchronously to meet 60s requirement
    setImmediate(() => {
      this.subscriptionService.processWebhook(payload).catch((err) => {
        this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
      });
    });

    return { status: 'received' };
  }

  /**
   * Timing-safe comparison to prevent timing attacks
   */
  private verifyAuth(authHeader: string, expectedSecret: string): boolean {
    const expected = `Bearer ${expectedSecret}`;
    if (!authHeader || authHeader.length !== expected.length) {
      return false;
    }
    try {
      return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
