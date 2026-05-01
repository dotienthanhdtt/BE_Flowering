import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { User } from '@/database/entities/user.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { AccessTierCacheService } from '@common/services/access-tier-cache.service';
import {
  REQUIRE_RESOURCE_ACCESS_KEY,
  ResourceAccessMeta,
} from '@common/decorators/require-resource-access.decorator';

/**
 * Guard that enforces resource-level entitlement.
 * Flow: resolve resource ID → lookup access_tier (cache-first) →
 *   free tier → allow; premium tier → check user subscription.
 *
 * Must run after JwtAuthGuard so request.user is populated.
 * Decorate endpoints with @RequireResourceAccess({ resource, paramKey?, bodyKey? }).
 */
@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tierCache: AccessTierCacheService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ResourceAccessMeta | undefined>(
      REQUIRE_RESOURCE_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No metadata — guard is a no-op
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<{
      user?: User;
      params: Record<string, string>;
      body: Record<string, unknown>;
    }>();

    const resourceId = this.resolveResourceId(request, meta);
    if (!resourceId) {
      // Cannot resolve ID; let the handler produce a 400/404 naturally
      return true;
    }

    const tier = await this.tierCache.get(meta.resource, resourceId);

    // Resource not found in DB → let handler produce 404
    if (tier === null) return true;

    // Free resources are always accessible
    if (tier === AccessTier.FREE) return true;

    // Premium resource: require authenticated premium user
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({
        code: 0,
        error_code: 'subscription_required',
        message: 'Premium subscription required to access this content',
      });
    }

    const isPremium = await this.subscriptionService.isUserPremium(user.id);
    if (!isPremium) {
      throw new ForbiddenException({
        code: 0,
        error_code: 'subscription_required',
        message: 'Premium subscription required to access this content',
      });
    }

    return true;
  }

  private resolveResourceId(
    request: { params: Record<string, string>; body: Record<string, unknown> },
    meta: ResourceAccessMeta,
  ): string | null {
    if (meta.paramKey) {
      const val = request.params[meta.paramKey];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    if (meta.bodyKey) {
      const val = request.body[meta.bodyKey];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    return null;
  }
}
