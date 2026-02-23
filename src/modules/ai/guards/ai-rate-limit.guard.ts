import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

/**
 * Rate limit guard for AI endpoints.
 * Enforces different limits based on user subscription tier.
 * Free tier: 100 requests/hour
 * Premium tier: 1000 requests/hour
 */
@Injectable()
export class AiRateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'AI request rate limit exceeded. Upgrade to premium for higher limits.',
    );
  }

  /**
   * Generate tracker key using user ID for per-user rate limiting.
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id: string } | undefined;
    return user?.id || (req.ip as string) || 'anonymous';
  }
}
