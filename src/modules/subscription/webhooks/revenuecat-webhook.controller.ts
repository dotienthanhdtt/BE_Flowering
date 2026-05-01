import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../../common/decorators/public-route.decorator';
import { SubscriptionService } from '../subscription.service';
import { RevenueCatWebhookDto } from '../dto/revenuecat-webhook.dto';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * Controller for RevenueCat webhook endpoint
 * Handles subscription lifecycle events from RevenueCat
 */
@Controller('webhooks')
export class RevenuecatWebhookController implements OnModuleInit {
  private readonly logger = new Logger(RevenuecatWebhookController.name);
  private webhookSecret: string | undefined;

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {}

  onModuleInit(): void {
    const secret = this.configService.get('revenuecat.webhookSecret', { infer: true });
    if (!secret) {
      this.logger.warn(
        'REVENUECAT_WEBHOOK_SECRET not configured — POST /webhooks/revenuecat will reject all requests',
      );
      return;
    }
    this.webhookSecret = secret;
  }

  @Public()
  @Post('revenuecat')
  @HttpCode(200)
  @ApiOperation({ summary: 'RevenueCat webhook endpoint' })
  @ApiExcludeEndpoint() // Hide from Swagger docs
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhookDto,
  ): Promise<{ status: string }> {
    if (!this.webhookSecret) {
      throw new UnauthorizedException('Webhook not configured');
    }
    // Always verify webhook authorization using timing-safe comparison
    if (!this.verifyAuth(authHeader, this.webhookSecret)) {
      this.logger.warn('Invalid webhook authorization attempt');
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    this.logger.log(
      `Received RevenueCat webhook: ${payload.event.type} for user ${payload.event.app_user_id}`,
    );

    await this.subscriptionService.processWebhook(payload);

    return { status: 'received' };
  }

  /**
   * Timing-safe comparison to prevent timing attacks
   */
  /**
   * Timing-safe comparison against the secret configured in the RC dashboard.
   * RC sends the Authorization header value verbatim — no scheme prefix.
   * The dashboard value and REVENUECAT_WEBHOOK_SECRET must match exactly.
   */
  private verifyAuth(authHeader: string, expectedSecret: string): boolean {
    if (!authHeader || authHeader.length !== expectedSecret.length) {
      return false;
    }
    try {
      return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedSecret));
    } catch {
      return false;
    }
  }
}
