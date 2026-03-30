import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { User } from '@/database/entities/user.entity';
import { REQUIRE_PREMIUM_KEY } from '@common/decorators/require-premium.decorator';

/**
 * Guard that checks if the authenticated user has an active premium subscription.
 * Must be used after JwtAuthGuard (global guard runs first).
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
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

    const subscription = await this.subscriptionService.getUserSubscription(user.id);

    if (!subscription || !subscription.isActive) {
      throw new ForbiddenException('Premium subscription required to access this feature');
    }

    return true;
  }
}
