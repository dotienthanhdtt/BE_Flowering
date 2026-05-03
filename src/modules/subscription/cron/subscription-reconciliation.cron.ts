/**
 * Nightly reconciliation cron — runs at 03:00 UTC daily.
 * Finds subscriptions that are out-of-sync with RevenueCat and corrects them.
 *
 * Target rows:
 *   a) cancelAtPeriodEnd=true AND currentPeriodEnd < now  (period ended, should be expired)
 *   b) status=ACTIVE AND currentPeriodEnd < now            (missed expiry webhook)
 *
 * Safety:
 *   - Circuit breaker: if RC REST is down, skips entire run (fail-open — no mass-revoke).
 *   - Batch size 100, parallelism 5 → well under 100 req/min RC rate limit.
 *   - applyRcGroundTruth event_timestamp_ms guard prevents stale writes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Subscription, SubscriptionStatus } from '../../../database/entities/subscription.entity';
import { SubscriptionService } from '../subscription.service';
import { RevenueCatRestClient } from '../clients/revenuecat-rest-client';
import { CircuitBreaker } from '../../../common/utils/circuit-breaker';

const BATCH_SIZE = 100;
const PARALLELISM = 5;

@Injectable()
export class SubscriptionReconciliationCron {
  private readonly logger = new Logger(SubscriptionReconciliationCron.name);

  /**
   * Shared with PremiumGuard via module-level singleton pattern.
   * Both use the same RC REST key; a single breaker state is appropriate.
   */
  private readonly rcBreaker = new CircuitBreaker({
    failureThreshold: 5,
    openDurationMs: 5 * 60 * 1000,
  });

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly subscriptionService: SubscriptionService,
    private readonly rcClient: RevenueCatRestClient,
  ) {}

  /**
   * Nightly at 03:00 UTC.
   * Exposed as public for test invocation.
   */
  @Cron('0 3 * * *', { name: 'subscription-reconciliation', timeZone: 'UTC' })
  async runReconciliation(): Promise<void> {
    const startMs = Date.now();
    let candidatesCount = 0;
    let reconciledCount = 0;
    let errorsCount = 0;

    if (this.rcBreaker.state === 'OPEN') {
      this.logger.warn(
        `event=reconciliation outcome=breaker_open — skipping run (fail-open, no revokes)`,
      );
      return;
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

    // Fetch candidates:
    //   a) currentPeriodEnd < now and not already EXPIRED (missed expiry / period-end cancel)
    //   b) ACTIVE but updatedAt > 7 days ago — catches refunded-mid-period rows where RC
    //      may have stopped returning the entitlement before our currentPeriodEnd
    const candidates = await this.subscriptionRepo.find({
      where: [
        { currentPeriodEnd: LessThan(now), status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED]) },
        { status: SubscriptionStatus.ACTIVE, updatedAt: LessThan(sevenDaysAgo) },
      ],
      order: { currentPeriodEnd: 'ASC', updatedAt: 'ASC' },
      take: BATCH_SIZE,
    });

    candidatesCount = candidates.length;

    if (candidatesCount === BATCH_SIZE) {
      this.logger.warn(
        `reconciliation: batch full (${BATCH_SIZE} candidates) — possible backlog; consider reducing reconciliation interval`,
      );
    }

    if (candidatesCount === 0) {
      this.logger.log(`reconciliation: no candidates found`);
      return;
    }

    this.logger.log(
      `reconciliation: found ${candidatesCount} candidate(s) — processing with parallelism=${PARALLELISM}`,
    );

    // Process in parallel chunks of PARALLELISM
    for (let i = 0; i < candidates.length; i += PARALLELISM) {
      const chunk = candidates.slice(i, i + PARALLELISM);
      const results = await Promise.allSettled(chunk.map((sub) => this.reconcileOne(sub)));

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          reconciledCount++;
        } else if (result.status === 'rejected') {
          errorsCount++;
        }
      }

      // Re-check breaker between chunks — abort if it opened mid-run
      // Cast via string to bypass TS control-flow narrowing from the early-return guard above
      if ((this.rcBreaker.state as string) === 'OPEN') {
        this.logger.warn(
          `event=reconciliation outcome=breaker_open mid-run — aborting remaining batches`,
        );
        break;
      }
    }

    const elapsedMs = Date.now() - startMs;
    const finalOutcome = errorsCount > 0 ? 'error' : reconciledCount > 0 ? 'reconciled' : 'unchanged';
    this.logger.log(
      `event=reconciliation outcome=${finalOutcome} candidates=${candidatesCount} reconciled=${reconciledCount} errors=${errorsCount} breaker=${this.rcBreaker.state} latency_ms=${elapsedMs}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reconcile a single subscription row against RC.
   * Returns true if applyRcGroundTruth was called (regardless of whether state changed).
   */
  private async reconcileOne(sub: Subscription): Promise<boolean> {
    const rcPayload = await this.rcBreaker.execute(() => this.rcClient.getSubscriber(sub.userId));

    if (rcPayload === null) {
      // Breaker returned null (either open or RC error) — skip, do not revoke
      this.logger.debug(`reconcileOne: skipped user ${sub.userId} (breaker or RC error)`);
      return false;
    }

    await this.subscriptionService.applyRcGroundTruth(sub.userId, rcPayload, 'cron');
    return true;
  }
}
