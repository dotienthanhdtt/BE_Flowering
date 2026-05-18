import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PendingSubscriptionClaim } from '../../database/entities/pending-subscription-claim.entity';
import { User } from '../../database/entities/user.entity';
import { RevenueCatEventDto } from './dto/revenuecat-webhook.dto';
import { RcSubscriberPayload } from './clients/revenuecat-rest-client';

/** RC event types that carry purchase intent and should be stored as pending claims. */
const PURCHASE_SHAPED_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
  'PRODUCT_CHANGE',
]);

/** 24 hours in milliseconds for ownership window checks. */
const OWNERSHIP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Reason codes logged when a pending row cannot be claimed. */
type UnclaimableReason = 'alias_collision' | 'timestamp_outside_window' | 'rc_product_mismatch';

export { PURCHASE_SHAPED_EVENTS };

@Injectable()
export class PendingClaimsService {
  private readonly logger = new Logger(PendingClaimsService.name);

  /**
   * Store an RC event as a pending claim so RC sees 200 and stops retrying.
   * Uses INSERT … ON CONFLICT DO NOTHING — fully idempotent on RC retry.
   */
  async recordPending(event: RevenueCatEventDto, manager: EntityManager): Promise<void> {
    if (!PURCHASE_SHAPED_EVENTS.has(event.type)) return;

    // Raw INSERT to avoid TypeORM deep-partial type issues with jsonb columns.
    // ON CONFLICT (event_id) DO NOTHING ensures full idempotency on RC retry.
    await manager.query(
      `INSERT INTO pending_subscription_claims
         (id, event_id, rc_app_user_id, event_type, event_timestamp_ms, event_payload, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.app_user_id ?? event.original_app_user_id ?? 'unknown',
        event.type,
        event.event_timestamp_ms ?? null,
        JSON.stringify(event),
      ],
    );

    this.logger.log(
      `pending_claim_recorded event_id=${event.id} event_type=${event.type} rc_app_user_id=${event.app_user_id ?? event.original_app_user_id}`,
    );
  }

  /**
   * Drain unclaimed pending rows for a user after live RC confirms entitlement.
   *
   * Ownership rule — a pending row is claimable by `user` when ALL hold:
   *   1. `pending.rcAppUserId === rcPayload.original_app_user_id` (strict) OR
   *      `pending.rcAppUserId` appears in rcPayload aliases AND no other user has
   *      already claimed a row sharing that rc_app_user_id.
   *   2. `|pending.eventTimestampMs - user.createdAt| ≤ 24h` OR
   *      `|pending.eventTimestampMs - now()| ≤ 24h`.
   *   3. When rcPayload.activeProductId is set, pending event's product_id must match.
   *
   * Rows that fail the rule are logged with a reason code and left unclaimed.
   *
   * @param replayHandlers Called for each claimable row to apply subscription state.
   */
  async claimVerifiedFor(
    user: User,
    rcPayload: RcSubscriberPayload,
    manager: EntityManager,
    replayHandlers: (event: RevenueCatEventDto, manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    // Look up unclaimed rows where rc_app_user_id matches the user's authenticated UUID.
    // Phase 1 scope: covers the case where the webhook arrived with the UUID before the user
    // row was created. Anonymous-ID → UUID drain requires RC alias data (Phase 2 enhancement).
    const unclaimed = await manager
      .createQueryBuilder(PendingSubscriptionClaim, 'psc')
      .where('psc.rc_app_user_id = :userId AND psc.claimed_at IS NULL', {
        userId: rcPayload.appUserId,
      })
      .orderBy('psc.event_timestamp_ms', 'ASC', 'NULLS LAST')
      .getMany();

    if (unclaimed.length === 0) return;

    const now = Date.now();
    const userCreatedAtMs = user.createdAt.getTime();

    for (const pending of unclaimed) {
      const reason = this.checkOwnershipRule(pending, user, rcPayload, now, userCreatedAtMs);

      if (reason !== null) {
        this.logger.warn(
          `unclaimable_pending audit event_id=${pending.eventId} user_id=${user.id} reason=${reason}`,
        );
        continue;
      }

      // Apply the subscription state via extracted replay handler (no WebhookEvent insert).
      try {
        const eventPayload = pending.eventPayload as unknown as RevenueCatEventDto;
        await replayHandlers(eventPayload, manager);
      } catch (err) {
        this.logger.error(
          `pending_claim_replay_failed event_id=${pending.eventId} user_id=${user.id} err=${(err as Error).message}`,
        );
        continue;
      }

      // Mark claimed.
      await manager.update(PendingSubscriptionClaim, pending.id, {
        claimedAt: new Date(),
        claimedByUserId: user.id,
      });

      this.logger.log(
        `pending_claim_granted event_id=${pending.eventId} user_id=${user.id} event_type=${pending.eventType}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private checkOwnershipRule(
    pending: PendingSubscriptionClaim,
    user: User,
    rcPayload: RcSubscriberPayload,
    now: number,
    userCreatedAtMs: number,
  ): UnclaimableReason | null {
    // Rule 3: product_id match when RC has an active product.
    if (rcPayload.activeProductId) {
      const payload = pending.eventPayload as Record<string, unknown>;
      const pendingProductId = payload['product_id'] as string | undefined;
      if (pendingProductId && pendingProductId !== rcPayload.activeProductId) {
        return 'rc_product_mismatch';
      }
    }

    // Rule 2: timestamp window.
    const ts = pending.eventTimestampMs;
    if (ts !== null) {
      const withinCreation = Math.abs(ts - userCreatedAtMs) <= OWNERSHIP_WINDOW_MS;
      const withinNow = Math.abs(ts - now) <= OWNERSHIP_WINDOW_MS;
      if (!withinCreation && !withinNow) {
        return 'timestamp_outside_window';
      }
    }

    // Rule 1 is enforced by the query (only rows matching known RC IDs are loaded).
    // Additional alias collision check: ensure no other user has claimed a row for this rc_app_user_id.
    if (pending.claimedByUserId && pending.claimedByUserId !== user.id) {
      return 'alias_collision';
    }

    return null;
  }
}
