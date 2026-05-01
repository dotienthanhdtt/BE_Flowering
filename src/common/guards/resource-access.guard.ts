import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { AccessTierCacheService } from '@common/services/access-tier-cache.service';

/**
 * Guard that enforces resource-level entitlement.
 *
 * NOTE: Premium gating is temporarily disabled — `canActivate` always returns true.
 * Re-enable by restoring the resource-tier lookup + subscription check flow.
 * Decorate endpoints with @RequireResourceAccess({ resource, paramKey?, bodyKey? }).
 */
@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(
    private readonly _reflector: Reflector,
    private readonly _tierCache: AccessTierCacheService,
    private readonly _subscriptionService: SubscriptionService,
  ) {
    void this._reflector;
    void this._tierCache;
    void this._subscriptionService;
  }

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    // TODO: temporarily disabled premium gating — re-enable when access logic is finalized
    return true;
  }
}
