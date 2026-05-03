import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { AccessTierCacheService } from '@common/services/access-tier-cache.service';
import {
  REQUIRE_RESOURCE_ACCESS_KEY,
  ResourceAccessMeta,
} from '@common/decorators/require-resource-access.decorator';
import { AccessTier } from '@/database/entities/access-tier.enum';

/**
 * Enforces resource-level entitlement on routes decorated with
 * `@RequireResourceAccess({ resource, paramKey?, bodyKey? })`.
 *
 * Flow: load tier from `AccessTierCacheService` → FREE allows everyone →
 * PREMIUM requires `req.user` and an active premium subscription, else 403.
 */
@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tierCache: AccessTierCacheService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<ResourceAccessMeta | undefined>(
      REQUIRE_RESOURCE_ACCESS_KEY,
      context.getHandler(),
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const resourceId =
      (meta.paramKey ? request.params?.[meta.paramKey] : undefined) ??
      (meta.bodyKey ? request.body?.[meta.bodyKey] : undefined);

    if (!resourceId || typeof resourceId !== 'string') {
      throw new BadRequestException(
        `Resource ID missing on request (resource=${meta.resource})`,
      );
    }

    const tier = await this.tierCache.get(meta.resource, resourceId);
    if (tier === null) {
      throw new NotFoundException(`${meta.resource} ${resourceId} not found`);
    }
    if (tier === AccessTier.FREE) return true;

    const user = request.user as { id: string } | undefined;
    if (!user) {
      throw new ForbiddenException('Premium content requires authentication');
    }

    const isPremium = await this.subscriptionService.isUserPremium(user.id);
    if (!isPremium) {
      throw new ForbiddenException('Premium subscription required');
    }
    return true;
  }
}
