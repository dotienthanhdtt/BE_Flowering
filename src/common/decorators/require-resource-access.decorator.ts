import { SetMetadata } from '@nestjs/common';
import { ResourceType } from '@common/services/access-tier-cache.service';

export const REQUIRE_RESOURCE_ACCESS_KEY = 'require_resource_access';

export interface ResourceAccessMeta {
  /** Which resource table to look up (e.g. 'scenario') */
  resource: ResourceType;
  /** Route param key holding the resource UUID (e.g. 'id') */
  paramKey?: string;
  /** Request body key holding the resource UUID (e.g. 'scenarioId') */
  bodyKey?: string;
}

/**
 * Marks an endpoint as requiring resource-level access control.
 * The guard resolves the resource ID from `request.params[paramKey]`
 * or `request.body[bodyKey]`, looks up `access_tier`, and blocks
 * free users from premium resources with a 403.
 *
 * Must be used together with ResourceAccessGuard.
 */
export const RequireResourceAccess = (meta: ResourceAccessMeta): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRE_RESOURCE_ACCESS_KEY, meta);
