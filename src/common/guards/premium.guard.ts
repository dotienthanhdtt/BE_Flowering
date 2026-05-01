import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { RevenueCatRestClient } from '@/modules/subscription/clients/revenuecat-rest-client';
import { CircuitBreaker } from '@common/utils/circuit-breaker';
import { User } from '@/database/entities/user.entity';
import { REQUIRE_PREMIUM_KEY } from '@common/decorators/require-premium.decorator';

/**
 * Guard that checks if the authenticated user has an active premium subscription.
 * Must be used after JwtAuthGuard (global guard runs first).
 *
 * Fallback path (DB miss or expired):
 *   Calls RevenueCat REST API (wrapped in circuit breaker).
 *   If RC says active → grant access this request and async-enqueue sync.
 *   Circuit breaker fail-open: when OPEN, skip RC call and return DB answer.
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  /**
   * Shared circuit breaker for all PremiumGuard RC fallback calls.
   * Static so state persists across request instances in the same process.
   */
  private static readonly rcBreaker = new CircuitBreaker({
    failureThreshold: 5,
    openDurationMs: 5 * 60 * 1000,
  });

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
    private readonly rcClient: RevenueCatRestClient,
  ) {}

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

    // Primary path: DB lookup
    const subscription = await this.subscriptionService.getUserSubscription(user.id);
    if (subscription?.isActive) return true;

    // Fallback path: RC REST (only when breaker is not OPEN)
    if (PremiumGuard.rcBreaker.state !== 'OPEN') {
      const rcPayload = await PremiumGuard.rcBreaker.execute(() =>
        this.rcClient.getSubscriber(user.id),
      );

      if (rcPayload?.hasActiveEntitlement) {
        // Async sync — do not await to keep guard latency low
        this.subscriptionService.applyRcGroundTruth(user.id, rcPayload, 'fallback').catch(() => {
          // Non-critical background sync; error already logged inside service
        });
        return true;
      }
    }

    throw new ForbiddenException('Premium subscription required to access this feature');
  }
}
