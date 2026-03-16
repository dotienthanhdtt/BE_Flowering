import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PREMIUM_KEY = 'require_premium';

/**
 * Marks endpoint as requiring an active premium subscription.
 * Use with PremiumGuard.
 */
export const RequirePremium = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRE_PREMIUM_KEY, true);
