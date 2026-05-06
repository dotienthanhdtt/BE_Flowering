import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { RevenueCatRestClient } from '@/modules/subscription/clients/revenuecat-rest-client';
import { CircuitBreaker } from '@common/utils/circuit-breaker';
import { User } from '@/database/entities/user.entity';
import { REQUIRE_PREMIUM_KEY } from '@common/decorators/require-premium.decorator';

/**
 * Guard that checks if the authenticated user has an active premium subscription.
 * Must be used after JwtAuthGuard (global guard runs first).
 *
 * Hot path (60s positive cache): cache hit → return true (no DB/RC).
 * Warm path (DB hit): DB says active → cache + return true.
 * Cold path (RC fallback): DB miss → RC fetch → await sync → cache if confirmed → grant.
 * Circuit breaker fail-open: when OPEN, skip RC and use DB answer.
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  private static readonly rcBreaker = new CircuitBreaker({
    failureThreshold: 5,
    openDurationMs: 5 * 60 * 1000,
  });
  private static readonly CACHE_TTL_MS = 60_000;

  private readonly logger = new Logger(PremiumGuard.name);
  private readonly cache = new Map<string, { expiresAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
    private readonly rcClient: RevenueCatRestClient,
  ) {}

  @OnEvent('subscription.changed')
  handleSubscriptionChanged(payload: { userId: string }): void {
    this.cache.delete(payload.userId);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirePremium = this.reflector.getAllAndOverride<boolean>(REQUIRE_PREMIUM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requirePremium) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as User | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required for premium features');
    }

    // Hot path: positive cache (no negative cache — avoids stale-grant lag after purchase)
    const cached = this.cache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      return true;
    }

    // Warm path: DB read
    const subscription = await this.subscriptionService.getUserSubscription(user.id);
    if (subscription?.isActive) {
      this.cache.set(user.id, { expiresAt: Date.now() + PremiumGuard.CACHE_TTL_MS });
      return true;
    }

    // Cold path: RC REST fallback (only when breaker is not OPEN)
    if (PremiumGuard.rcBreaker.state !== 'OPEN') {
      const rcPayload = await PremiumGuard.rcBreaker.execute(() =>
        this.rcClient.getSubscriber(user.id),
      );

      if (rcPayload?.hasActiveEntitlement) {
        try {
          await this.subscriptionService.applyRcGroundTruth(user.id, rcPayload, 'fallback');
          // Re-read DB to prime the cache with the freshly-synced state
          const updated = await this.subscriptionService.getUserSubscription(user.id);
          if (updated?.isActive) {
            this.cache.set(user.id, { expiresAt: Date.now() + PremiumGuard.CACHE_TTL_MS });
          }
        } catch (err) {
          this.logger.error(
            `RC ground truth sync failed for user ${user.id}: ${(err as Error).message}`,
            (err as Error).stack,
          );
          // Sync failure is non-blocking: RC already confirmed active entitlement
        }
        return true;
      }
    }

    throw new ForbiddenException('Premium subscription required to access this feature');
  }
}
