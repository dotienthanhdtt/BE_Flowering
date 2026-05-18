import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
  Logger,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public-route.decorator';
import { SubscriptionService } from '../subscription.service';
import { RevenueCatWebhookDto } from '../dto/revenuecat-webhook.dto';
import { AppConfiguration } from '../../../config/app-configuration';

const REPLAY_WINDOW_MS = 24 * 3600 * 1000;

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
      if (process.env.NODE_ENV === 'production') {
        throw new Error('REVENUECAT_WEBHOOK_SECRET must be set in production. Aborting startup.');
      }
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
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'RevenueCat webhook endpoint' })
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhookDto,
  ): Promise<{ status: string; outcome?: string }> {
    if (!this.webhookSecret) {
      this.logger.warn(
        `event=${payload.event?.type ?? 'UNKNOWN'} outcome=auth_failed reason=webhook_not_configured`,
      );
      throw new UnauthorizedException('Webhook not configured');
    }
    if (!this.verifyAuth(authHeader, this.webhookSecret)) {
      this.logger.warn(
        `event=${payload.event?.type ?? 'UNKNOWN'} outcome=auth_failed userId=${payload.event?.app_user_id ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    const eventTimestamp = payload.event.event_timestamp_ms;
    if (eventTimestamp !== undefined && Math.abs(Date.now() - eventTimestamp) > REPLAY_WINDOW_MS) {
      // direction=past when event is older than now; direction=future when event timestamp is ahead
      const direction = Math.sign(Date.now() - eventTimestamp) >= 0 ? 'past' : 'future';
      this.logger.warn(
        `event=${payload.event.type} outcome=stale_dropped id=${payload.event.id} timestamp=${eventTimestamp} direction=${direction} userId=${payload.event.app_user_id ?? 'unknown'}`,
      );
      return { status: 'stale_dropped', outcome: 'stale_dropped' };
    }

    this.logger.log(
      `event=${payload.event.type} outcome=processing id=${payload.event.id} userId=${payload.event.app_user_id ?? 'unknown'}`,
    );

    const result = await this.subscriptionService.processWebhook(payload);

    return { status: 'received', ...result };
  }

  /**
   * Accepts both "Bearer <secret>" and bare "<secret>" formats.
   * Strips the "Bearer " prefix (case-insensitive) before comparison so either
   * dashboard config format works without reconfiguring the secret.
   * Length-mismatch short-circuit is acceptable — timing leak on length is
   * negligible for a fixed-length secret.
   */
  private verifyAuth(authHeader: string, expectedSecret: string): boolean {
    if (!authHeader) return false;
    const token = authHeader.replace(/^bearer\s+/i, '');
    if (token.length !== expectedSecret.length) return false;
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(expectedSecret));
    } catch {
      return false;
    }
  }
}
