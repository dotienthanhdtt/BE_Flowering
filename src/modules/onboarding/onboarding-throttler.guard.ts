import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

/**
 * Dual-limit throttler for public onboarding endpoints.
 *
 * Design rationale:
 * - A request WITHOUT `body.conversationId` is treated as a session creation attempt.
 *   These are more expensive (new AI session bootstrapped) and more abuse-prone, so
 *   the limit is tight: **5 requests / hour per IP**.
 * - A request WITH `body.conversationId` is a continuation of an existing session.
 *   Higher throughput is acceptable: **30 requests / hour per IP**.
 *
 * Both branches share the same TTL window (1 hour = 3_600_000 ms) and use default
 * IP-based tracking inherited from `ThrottlerGuard`.
 *
 * Usage: replace `ThrottlerGuard` + per-method `@Throttle` decorators in the
 * controller with a single `@UseGuards(OnboardingThrottlerGuard)`.
 */
@Injectable()
export class OnboardingThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const httpReq = requestProps.context.switchToHttp().getRequest();
    // GET routes (e.g. /conversations/:conversationId/messages) carry the id in the
    // URL path, not the body — treat those as "continuation" (30/hr) rather than
    // "creation" (5/hr) so cheap reads aren't starved by the creation budget.
    const hasConversationId =
      !!httpReq.body?.conversationId || !!httpReq.params?.conversationId;

    return super.handleRequest({
      ...requestProps,
      limit: hasConversationId ? 30 : 5,
      ttl: 3_600_000,
    });
  }
}
