import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { WebhookEvent } from '../../database/entities/webhook-event.entity';
import {
  RevenueCatWebhookDto,
  RevenueCatEventDto,
  RevenueCatCancelReason,
} from './dto/revenuecat-webhook.dto';
import { SubscriptionDto } from './dto/subscription.dto';
import { RcSubscriberPayload, RevenueCatRestClient } from './clients/revenuecat-rest-client';
import { isUniqueViolation } from './utils/db-errors.util';
import { PendingClaimsService, PURCHASE_SHAPED_EVENTS } from './pending-claims.service';
import { PendingSubscriptionClaim } from '../../database/entities/pending-subscription-claim.entity';

/** Cancel reasons that trigger immediate revocation (not period-end). */
const IMMEDIATE_REVOKE_REASONS: RevenueCatCancelReason[] = ['CUSTOMER_SUPPORT', 'BILLING_ERROR'];

/** Hard cap for subscriptions with an unrecognised product ID. */
const UNKNOWN_PLAN_MAX_DURATION_MS = 7 * 24 * 3600 * 1000;

/** RC events that should be silently acknowledged — we don't act on them yet. */
const SILENT_ACK_EVENTS = new Set<string>([
  'TEST',
  'INVOICE_ISSUANCE',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'EXPERIMENT_ENROLLMENT',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isResolvableCandidate = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && !id.startsWith('$RCAnonymousID:');

/**
 * Service handling subscription operations and RevenueCat webhook processing.
 */
/** 5-minute in-memory reconcile cache keyed by userId. */
const reconcileCache = new Map<string, number>();
const RECONCILE_TTL_MS = 5 * 60 * 1000;

/** Stable bigint hash from a UUID string for pg_advisory_xact_lock. */
function hashTextToInt(text: string): number {
  // djb2-like hash that fits within a 32-bit signed integer (PostgreSQL advisory lock range).
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash |= 0; // keep 32-bit signed
  }
  return hash;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly pendingClaims: PendingClaimsService,
    private readonly rcClient: RevenueCatRestClient,
  ) {}

  private emitChanged(userId: string): void {
    this.eventEmitter.emit('subscription.changed', { userId });
  }

  /**
   * Get user's current subscription.
   */
  async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription) return null;
    return this.mapToDto(subscription);
  }

  /**
   * Get user subscription with RC reconciliation (called from controller GET /me).
   * Acquires a per-user advisory lock to prevent double-replay on concurrent requests.
   * Uses a 5-min in-memory cache to avoid hammering the RC REST API.
   *
   * @param user - Authenticated user from JWT (never trust client-supplied IDs).
   * @param iapVersion - Value of X-Client-Iap-Version request header.
   */
  async getSubscriptionWithReconcile(
    user: User,
    iapVersion?: string,
  ): Promise<SubscriptionDto | null> {
    return this.dataSource.transaction(async (mgr) => {
      // Per-user advisory lock: serialises concurrent /subscriptions/me calls for the same user.
      await mgr.query('SELECT pg_advisory_xact_lock($1)', [hashTextToInt(user.id)]);

      // 5-min reconcile cache: skip RC call if we reconciled recently.
      const lastReconcile = reconcileCache.get(user.id) ?? 0;
      const shouldReconcile = Date.now() - lastReconcile > RECONCILE_TTL_MS;

      if (shouldReconcile) {
        const rcPayload = await this.rcClient.getSubscriber(user.id);

        if (rcPayload) {
          // Apply RC ground truth (fallback: date-aware expire per C3).
          await this.applyRcGroundTruth(user.id, rcPayload, 'fallback');

          if (rcPayload.hasActiveEntitlement) {
            // Drain any pending claims that RC now confirms for this user.
            await this.pendingClaims.claimVerifiedFor(user, rcPayload, mgr, (event, manager) =>
              this.replayHandlers(event, user, manager),
            );
          } else {
            // Check if pending rows exist — do NOT grant without RC confirmation.
            const pendingCount = await mgr
              .getRepository(PendingSubscriptionClaim)
              .createQueryBuilder('psc')
              .where('psc.rc_app_user_id = :id AND psc.claimed_at IS NULL', { id: user.id })
              .getCount()
              .catch(() => 0);

            if (pendingCount > 0) {
              this.logger.warn(
                `pending_unverified_skipped userId=${user.id} count=${pendingCount} — RC has no active entitlement`,
              );
            }
          }
        }

        reconcileCache.set(user.id, Date.now());
      }

      const subscription = await mgr.findOne(Subscription, { where: { userId: user.id } });
      if (!subscription) return null;
      return this.mapToDto(subscription, iapVersion);
    });
  }

  /**
   * Process a RevenueCat webhook event.
   *
   * Guards (in order): sandbox-in-prod filter → silent-ack short-circuit →
   * transactional dispatch (idempotency lock + handler in one atomic unit).
   *
   * If the handler throws, the transaction rolls back including the
   * idempotency row, so RevenueCat's retry will reprocess the event.
   *
   * Returns an outcome string for the controller to propagate in the response body.
   */
  async processWebhook(payload: RevenueCatWebhookDto): Promise<{ outcome: string }> {
    const { event } = payload;
    const startMs = Date.now();

    if (process.env.NODE_ENV === 'production' && event.environment === 'SANDBOX') {
      this.logger.warn(
        `event=${event.type} outcome=sandbox_dropped id=${event.id} userId=${event.app_user_id ?? 'unknown'}`,
      );
      return { outcome: 'sandbox_dropped' };
    }

    if (SILENT_ACK_EVENTS.has(event.type)) {
      this.logger.debug(`event=${event.type} outcome=ack_silent id=${event.id}`);
      // Still record it for idempotency — outside a transaction is fine since handler is a no-op.
      await this.recordIdempotency(event);
      return { outcome: 'processed' };
    }

    let outcome = 'processed';

    const touchedIds = await this.dataSource.transaction(async (manager) => {
      // Idempotency lock — insert first; on duplicate-key, we've seen this event before.
      try {
        await manager.insert(WebhookEvent, { eventId: event.id, eventType: event.type });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          outcome = 'duplicate';
          this.logger.debug(
            `event=${event.type} outcome=duplicate id=${event.id} userId=${event.app_user_id ?? 'unknown'}`,
          );
          return [];
        }
        throw error;
      }

      return this.dispatch(event, manager);
    });

    const latencyMs = Date.now() - startMs;

    // Emit after transaction commits so guard re-reads committed state
    for (const id of touchedIds ?? []) {
      this.emitChanged(id);
    }

    this.logger.log(
      `event=${event.type} outcome=${outcome} id=${event.id} userId=${event.app_user_id ?? 'unknown'} latency_ms=${latencyMs}`,
    );

    return { outcome };
  }

  /** Insert idempotency row, swallow duplicate-key errors. Used outside transactions. */
  private async recordIdempotency(event: RevenueCatEventDto): Promise<void> {
    try {
      await this.webhookEventRepo.insert({ eventId: event.id, eventType: event.type });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  /** Resolve event to user, apply out-of-order guard, route to handler. Returns mutated userIds. */
  private async dispatch(event: RevenueCatEventDto, manager: EntityManager): Promise<string[]> {
    const userRepo = manager.getRepository(User);

    // TRANSFER has its own user-resolution path; delegate before standard user lookup.
    if (event.type === 'TRANSFER') {
      const subscriptionRepo = manager.getRepository(Subscription);
      return this.handleTransfer(event, subscriptionRepo, userRepo);
    }

    const user = await this.resolveUser(event, userRepo);
    if (!user) {
      // C1: No user found — store as pending claim so RC sees 200 and stops retrying.
      if (PURCHASE_SHAPED_EVENTS.has(event.type)) {
        await this.pendingClaims.recordPending(event, manager);
        this.logger.warn(
          `pending_claim event=${event.type} id=${event.id} app_user_id=${event.app_user_id ?? 'null'} — stored for reconciliation`,
        );
      } else {
        this.logger.warn(
          `User not found for RC event ${event.id} (app_user_id=${event.app_user_id ?? 'null'}) — skipping non-purchase event`,
        );
      }
      return [];
    }

    const subscriptionRepo = manager.getRepository(Subscription);

    // Single locked read — result reused by stale guard and handlers to avoid double round-trip.
    const existing = await subscriptionRepo.findOne({
      where: { userId: user.id },
      lock: { mode: 'pessimistic_write' },
    });

    this.logUserDrift(event, existing, user.id);

    if (this.isStaleEvent(event, existing)) {
      this.logger.warn(`Stale event ${event.id} ts=${event.event_timestamp_ms} — skipping`);
      return [];
    }

    await this.replayHandlers(event, user, manager);
    return [user.id];
  }

  /**
   * Core handler dispatch — extracted from dispatch() so pending-claim replay can
   * call this without re-inserting a WebhookEvent row (already inserted on original receipt).
   */
  async replayHandlers(
    event: RevenueCatEventDto,
    user: User,
    manager: EntityManager,
  ): Promise<void> {
    const subscriptionRepo = manager.getRepository(Subscription);

    const existing = await subscriptionRepo.findOne({
      where: { userId: user.id },
      lock: { mode: 'pessimistic_write' },
    });

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'NON_RENEWING_PURCHASE':
      case 'TEMPORARY_ENTITLEMENT_GRANT':
      case 'REFUND_REVERSED':
        await this.handlePurchaseOrRenewal(user.id, event, subscriptionRepo, existing);
        break;
      case 'PRODUCT_CHANGE':
        await this.handleProductChange(user.id, event, subscriptionRepo, existing);
        break;
      case 'SUBSCRIPTION_EXTENDED':
        await this.handleExtension(user.id, event, subscriptionRepo);
        break;
      case 'REFUND':
        await this.handleRefund(user.id, event, subscriptionRepo, existing);
        break;
      case 'CANCELLATION':
        await this.handleCancellation(user.id, event, subscriptionRepo, existing);
        break;
      case 'EXPIRATION':
        await this.handleExpiration(user.id, event, subscriptionRepo);
        break;
      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user.id, event, subscriptionRepo);
        break;
      case 'SUBSCRIPTION_PAUSED':
        await this.handlePaused(user.id, event, subscriptionRepo);
        break;
      default:
        this.logger.warn(`Unhandled RC event type: ${event.type}`);
    }
  }

  /**
   * Resolve a User row from any of the IDs RC may send.
   *
   * Precedence:
   *   1. `app_user_id` (current logged-in identity).
   *   2. `original_app_user_id` (first ID ever used; often the anonymous ID).
   *   3. `aliases[]` fallback — emits a warning so we can audit RC linking drift.
   *
   * UUID-shaped, non-anonymous candidates are checked against `users.id`. This
   * prevents an older anonymous-linked alias from winning over the current
   * logged-in UUID when both resolve to different rows.
   */
  private async resolveUser(
    event: RevenueCatEventDto,
    userRepo: Repository<User>,
  ): Promise<User | null> {
    const tryLookup = async (id: string | undefined): Promise<User | null> => {
      if (!isResolvableCandidate(id) || !UUID_RE.test(id)) return null;
      return userRepo.findOne({ where: { id } });
    };

    const primary = await tryLookup(event.app_user_id);
    if (primary) return primary;

    const original = await tryLookup(event.original_app_user_id);
    if (original) return original;

    for (const alias of event.aliases ?? []) {
      const aliasUser = await tryLookup(alias);
      if (aliasUser) {
        this.logger.warn(
          `resolveUser_via_aliases userId=${aliasUser.id} alias=${alias} event_id=${event.id} event_type=${event.type}`,
        );
        return aliasUser;
      }
    }
    return null;
  }

  /**
   * Warn when an event's `app_user_id` differs from the row already on file.
   * Signals RC alias-linking drift or a missed `RC.logIn(uuid)` on the client.
   * Skipped on first-time row creation and when either side is anonymous.
   */
  private logUserDrift(
    event: RevenueCatEventDto,
    existing: Subscription | null,
    resolvedUserId: string,
  ): void {
    if (!existing) return;
    const eventAppUserId = event.app_user_id;
    const storedAppUserId = existing.appUserId;
    if (!eventAppUserId || !storedAppUserId) return;
    if (
      eventAppUserId.startsWith('$RCAnonymousID:') ||
      storedAppUserId.startsWith('$RCAnonymousID:')
    ) {
      return;
    }
    if (eventAppUserId === storedAppUserId) return;

    this.logger.warn(
      `subscription_user_drift userId=${resolvedUserId} event_app_user_id=${eventAppUserId} stored_app_user_id=${storedAppUserId} event_type=${event.type} event_id=${event.id}`,
    );
  }

  private isStaleEvent(event: RevenueCatEventDto, existing: Subscription | null): boolean {
    const incomingTs = event.event_timestamp_ms ?? null;
    if (incomingTs === null || !existing || existing.eventTimestampMs === null) return false;
    return incomingTs <= existing.eventTimestampMs;
  }

  // ---------------------------------------------------------------------------
  // Private handlers — all take the transactional Subscription repo
  // ---------------------------------------------------------------------------

  private async handlePurchaseOrRenewal(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    if (!event.product_id) {
      this.logger.warn(`Event ${event.id} (${event.type}) missing product_id — skipping`);
      return;
    }
    const plan = this.mapProductToPlan(event.product_id);

    // C2: Hard cap for unknown SKUs — prevents permanent premium from unrecognised product IDs.
    let expiresAt: Date | undefined;
    if (plan === SubscriptionPlan.UNKNOWN) {
      const cappedEnd = new Date(
        Math.min(
          event.expiration_at_ms ?? Date.now() + UNKNOWN_PLAN_MAX_DURATION_MS,
          Date.now() + UNKNOWN_PLAN_MAX_DURATION_MS,
        ),
      );
      expiresAt = cappedEnd;
      this.logger.error(
        `unknown_product_id productId=${event.product_id} eventId=${event.id} userId=${userId} cappedUntil=${cappedEnd.toISOString()}`,
      );
    } else {
      expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
    }

    const purchaseDate = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();

    const tsField = { eventTimestampMs: event.event_timestamp_ms ?? null };

    if (existing) {
      await subscriptionRepo.update(existing.id, {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        cancelAtPeriodEnd: false,
        appUserId: event.app_user_id ?? event.original_app_user_id,
        ...tsField,
      });
    } else {
      const sub = subscriptionRepo.create({
        userId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: expiresAt,
        currentPeriodStart: purchaseDate,
        appUserId: event.app_user_id ?? event.original_app_user_id,
        ...tsField,
      });
      await subscriptionRepo.save(sub);
    }

    this.logger.log(`Subscription activated for user ${userId}: ${plan} (event=${event.type})`);
  }

  /** PRODUCT_CHANGE — switch plan to new_product_id (or product_id) and refresh expiry. */
  private async handleProductChange(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    const productId = event.new_product_id ?? event.product_id;
    if (!productId) {
      this.logger.warn(`PRODUCT_CHANGE event ${event.id} missing product info — skipping`);
      return;
    }
    await this.handlePurchaseOrRenewal(
      userId,
      { ...event, product_id: productId },
      subscriptionRepo,
      existing,
    );
  }

  /** SUBSCRIPTION_EXTENDED — push currentPeriodEnd forward; do NOT change plan or status. */
  private async handleExtension(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    if (!event.expiration_at_ms) {
      this.logger.warn(`SUBSCRIPTION_EXTENDED ${event.id} missing expiration_at_ms — skipping`);
      return;
    }
    const result = await subscriptionRepo.update(
      { userId },
      {
        currentPeriodEnd: new Date(event.expiration_at_ms),
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    if (!result.affected || result.affected === 0) {
      this.logger.warn(
        `handleExtension: no subscription found for user ${userId} — 0 rows updated (event=${event.id}, expiration_at_ms=${event.expiration_at_ms})`,
      );
    } else {
      this.logger.log(`Subscription extended for user ${userId} until ${event.expiration_at_ms}`);
    }
  }

  /** REFUND — immediately revoke premium access. Idempotent: repeated calls leave status=EXPIRED. */
  private async handleRefund(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    if (!existing) {
      this.logger.warn(
        `REFUND event ${event.id}: no subscription found for user ${userId} — skipping`,
      );
      return;
    }
    const incomingTs = event.event_timestamp_ms ?? null;
    // Preserve the existing guard when the event has no timestamp — avoids nulling out
    // the out-of-order guard, which would let a subsequent stale RENEWAL slip through.
    const effectiveTs =
      existing.eventTimestampMs !== null && incomingTs === null
        ? existing.eventTimestampMs
        : incomingTs;

    await subscriptionRepo.update(existing.id, {
      status: SubscriptionStatus.EXPIRED,
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      eventTimestampMs: effectiveTs,
    });
    this.logger.log(`Subscription refunded (immediately revoked) for user ${userId}`);

    // Warn when CANCELLATION with support/billing reason is the actual refund channel
    // so we can audit whether RC emits REFUND directly or routes through CANCELLATION.
  }

  /**
   * CANCELLATION — differentiate by cancel_reason:
   *   UNSUBSCRIBE / DEVELOPER_INITIATED / PRICE_INCREASE / UNKNOWN → period-end
   *     (keep ACTIVE, set cancelAtPeriodEnd=true).
   *   CUSTOMER_SUPPORT / BILLING_ERROR → immediate revoke (refunds and support pulls).
   */
  private async handleCancellation(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    existing: Subscription | null,
  ): Promise<void> {
    const reason = event.cancel_reason as RevenueCatCancelReason | undefined;
    const isImmediateRevoke = reason !== undefined && IMMEDIATE_REVOKE_REASONS.includes(reason);

    if (!existing) {
      this.logger.warn(
        `handleCancellation: no subscription found for user ${userId} — 0 rows updated (event=${event.id})`,
      );
      return;
    }

    if (isImmediateRevoke) {
      const result = await subscriptionRepo.update(existing.id, {
        status: SubscriptionStatus.EXPIRED,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      });
      if (!result.affected || result.affected === 0) {
        this.logger.warn(
          `handleCancellation: no subscription updated for user ${userId} id=${existing.id} — 0 rows updated (event=${event.id})`,
        );
      } else {
        this.logger.log(
          `Subscription immediately revoked (cancel_reason=${reason}) for user ${userId}`,
        );
      }
    } else {
      const result = await subscriptionRepo.update(existing.id, {
        cancelAtPeriodEnd: true,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      });
      if (!result.affected || result.affected === 0) {
        this.logger.warn(
          `handleCancellation: no subscription updated for user ${userId} id=${existing.id} — 0 rows updated (event=${event.id})`,
        );
      } else {
        this.logger.log(
          `Subscription will cancel at period end (cancel_reason=${reason ?? 'UNSUBSCRIBE'}) for user ${userId}`,
        );
      }
    }
  }

  private async handleExpiration(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    const result = await subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.EXPIRED,
        plan: SubscriptionPlan.FREE,
        cancelAtPeriodEnd: false,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    if (!result.affected || result.affected === 0) {
      this.logger.warn(
        `handleExpiration: no subscription found for user ${userId} — 0 rows updated (event=${event.id})`,
      );
    } else {
      this.logger.log(
        `Subscription expired for user ${userId} (reason=${event.expiration_reason ?? 'UNKNOWN'}) event=${event.type} userId=${userId}`,
      );
    }
  }

  /**
   * BILLING_ISSUE — RC is retrying the charge. The subscription is NOT expired yet;
   * if a grace period is in effect, the user keeps premium access until grace ends.
   * We log the grace deadline; expiry will arrive as a separate EXPIRATION event.
   */
  private async handleBillingIssue(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    await subscriptionRepo.update(
      { userId },
      { eventTimestampMs: event.event_timestamp_ms ?? null },
    );
    const graceUntil = event.grace_period_expiration_at_ms
      ? new Date(event.grace_period_expiration_at_ms).toISOString()
      : 'none';
    this.logger.warn(`Billing issue for user ${userId} (grace_until=${graceUntil})`);
  }

  /** SUBSCRIPTION_PAUSED → status=PAUSED; no access during pause. Captures auto_resume_at_ms if present. */
  private async handlePaused(
    userId: string,
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
  ): Promise<void> {
    const resumeMs = event.auto_resume_at_ms ?? null;
    const result = await subscriptionRepo.update(
      { userId },
      {
        status: SubscriptionStatus.PAUSED,
        autoResumeAt: resumeMs ? new Date(resumeMs) : null,
        eventTimestampMs: event.event_timestamp_ms ?? null,
      },
    );
    if (!result.affected || result.affected === 0) {
      this.logger.warn(
        `handlePaused: no subscription found for user ${userId} — 0 rows updated (event=${event.id})`,
      );
    } else {
      this.logger.log(
        `Subscription paused for user ${userId} event=${event.type} autoResumeAt=${resumeMs ? new Date(resumeMs).toISOString() : 'none'}`,
      );
    }
  }

  /**
   * TRANSFER — relink subscription row from transferred_from userId to transferred_to.
   * RC sends both as arrays; we use the first ID in each. Validates both exist before
   * relinking to prevent silent privilege grants.
   */
  private async handleTransfer(
    event: RevenueCatEventDto,
    subscriptionRepo: Repository<Subscription>,
    userRepo: Repository<User>,
  ): Promise<string[]> {
    const fromId = event.transferred_from?.[0];
    const toId = event.transferred_to?.[0];

    if (!fromId || !toId) {
      this.logger.error(
        `TRANSFER event ${event.id} missing transferred_from/transferred_to — skipping`,
      );
      return [];
    }
    if ((event.transferred_from?.length ?? 0) > 1 || (event.transferred_to?.length ?? 0) > 1) {
      this.logger.warn(
        `TRANSFER event ${event.id} has multiple from/to IDs — using first only ` +
          `(from=${event.transferred_from?.join(',')}, to=${event.transferred_to?.join(',')})`,
      );
    }

    const [fromUser, toUser] = await Promise.all([
      userRepo.findOne({ where: { id: fromId } }),
      userRepo.findOne({ where: { id: toId } }),
    ]);

    if (!fromUser) {
      this.logger.warn(`TRANSFER: source user ${fromId} not found — skipping`);
      return [];
    }
    if (!toUser) {
      this.logger.warn(`TRANSFER: destination user ${toId} not found — skipping`);
      return [];
    }

    // Lock rows in consistent userId order to prevent AB/BA deadlock on concurrent swapped TRANSFERs.
    const [firstId, secondId] = [fromId, toId].sort();
    const [firstRow, secondRow] = await Promise.all([
      subscriptionRepo.findOne({ where: { userId: firstId }, lock: { mode: 'pessimistic_write' } }),
      subscriptionRepo.findOne({
        where: { userId: secondId },
        lock: { mode: 'pessimistic_write' },
      }),
    ]);
    const subscription = firstId === fromId ? firstRow : secondRow;
    const existingDestination = firstId === toId ? firstRow : secondRow;

    if (!subscription) {
      this.logger.warn(`TRANSFER: no subscription found for source user ${fromId} — skipping`);
      return [];
    }

    if (existingDestination) {
      this.logger.error(
        `TRANSFER_CONFLICT eventId=${event.id} sourceUserId=${fromId} destUserId=${toId} ` +
          `sourceSubId=${subscription.id} destSubId=${existingDestination.id} ` +
          `sourceUpdated=${subscription.updatedAt.toISOString()} destUpdated=${existingDestination.updatedAt.toISOString()}`,
      );
      // Do NOT throw. Return 200 to RC. Manual support resolution.
      return [];
    }

    await subscriptionRepo.update(subscription.id, {
      userId: toId,
      eventTimestampMs: event.event_timestamp_ms ?? null,
    });
    this.logger.log(`Subscription transferred from user ${fromId} to ${toId}`);
    return [fromId, toId];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Map RC product identifier to internal SubscriptionPlan.
   * Uses substring matching to cover store-specific suffixes (e.g. _ios, _android).
   * Returns UNKNOWN (never throws) for unrecognised IDs — capped at 7 days in handlePurchaseOrRenewal.
   * Add new product prefixes here when launching new SKUs.
   * See runbooks/iap-unknown-sku.md for triage steps when UNKNOWN rows appear.
   */
  private mapProductToPlan(productId: string): SubscriptionPlan {
    const lower = productId.toLowerCase();
    if (lower.includes('lifetime')) return SubscriptionPlan.LIFETIME;
    if (lower.includes('yearly') || lower.includes('annual')) return SubscriptionPlan.YEARLY;
    if (lower.includes('monthly')) return SubscriptionPlan.MONTHLY;
    this.logger.error(
      `unknown_product_id productId="${productId}" — writing plan=unknown with 7d cap`,
    );
    return SubscriptionPlan.UNKNOWN;
  }

  /**
   * Returns true if the user has an active non-free subscription.
   * Used by resource-level access guards.
   */
  async isUserPremium(userId: string): Promise<boolean> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription || subscription.plan === SubscriptionPlan.FREE) return false;
    return this.isSubscriptionActive(subscription);
  }

  /**
   * Check if subscription is currently active (considers expiration and status).
   * UNKNOWN plan: requires non-null currentPeriodEnd that is still in the future.
   * Null expiry on UNKNOWN → inactive (closes the NON_RENEWING_PURCHASE null-expiry hole).
   */
  isSubscriptionActive(subscription: Subscription): boolean {
    if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
    if (subscription.plan === SubscriptionPlan.LIFETIME) return true;
    if (subscription.plan === SubscriptionPlan.UNKNOWN) {
      return !!subscription.currentPeriodEnd && subscription.currentPeriodEnd > new Date();
    }
    if (!subscription.currentPeriodEnd) return true;
    return subscription.currentPeriodEnd > new Date();
  }

  private mapToDto(subscription: Subscription, iapVersion?: string): SubscriptionDto {
    // C2 compat shim: old clients (no X-Client-Iap-Version: 2 header) receive 'monthly'
    // for UNKNOWN rows so they still render a premium state. New clients get the raw value.
    // Remove this shim after the new client build is fully rolled out (≥30 days post-release).
    const plan =
      subscription.plan === SubscriptionPlan.UNKNOWN && iapVersion !== '2'
        ? SubscriptionPlan.MONTHLY
        : subscription.plan;

    return {
      id: subscription.id,
      plan,
      status: subscription.status,
      expiresAt: subscription.currentPeriodEnd,
      isActive: this.isSubscriptionActive(subscription),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      autoResumeAt: subscription.autoResumeAt ?? null,
    };
  }

  /**
   * Apply RC ground truth to a user's subscription row.
   * Safe to call concurrently with webhook handlers — the out-of-order
   * timestamp guard (event_timestamp_ms) prevents stale writes.
   *
   * @param source - 'fallback' (PremiumGuard read-path) | 'cron' (reconciliation)
   */
  async applyRcGroundTruth(
    userId: string,
    rcPayload: RcSubscriberPayload,
    source: 'fallback' | 'cron' = 'cron',
  ): Promise<void> {
    const incomingTs = rcPayload.fetchedAtMs;
    let changed = false;

    await this.dataSource.transaction(async (mgr) => {
      const existing = await mgr.findOne(Subscription, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      // Out-of-order guard: skip if stored timestamp is same or newer
      if (
        existing &&
        existing.eventTimestampMs !== null &&
        incomingTs <= existing.eventTimestampMs
      ) {
        this.logger.warn(
          `applyRcGroundTruth: stale payload ts=${incomingTs} <= stored=${existing.eventTimestampMs} for user ${userId} (source=${source}) — skipping`,
        );
        return;
      }

      const hasActive = rcPayload.hasActiveEntitlement;
      const expiresAtMs = rcPayload.activeExpiresAtMs;
      const productId = rcPayload.activeProductId;

      if (hasActive && productId) {
        const plan = this.mapProductToPlan(productId);
        const currentPeriodEnd = expiresAtMs ? new Date(expiresAtMs) : undefined;
        const beforeStatus = existing?.status ?? 'none';

        if (existing) {
          await mgr.update(Subscription, existing.id, {
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            eventTimestampMs: incomingTs,
          });
        } else {
          const sub = mgr.create(Subscription, {
            userId,
            plan,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
            eventTimestampMs: incomingTs,
          });
          await mgr.save(Subscription, sub);
        }

        this.logger.log(
          `applyRcGroundTruth: ACTIVE applied for user ${userId} plan=${plan} (${beforeStatus}→ACTIVE source=${source})`,
        );
        changed = true;
      } else if (existing && existing.status === SubscriptionStatus.ACTIVE) {
        // C3: fallback path — only write EXPIRED when currentPeriodEnd has already elapsed.
        // This prevents RC drift (e.g. brief RC outage or stale payload) from revoking
        // access for a user whose subscription is still within its paid period.
        // Cron path retains the original behaviour (true revocations for cancelled-within-period).
        if (source === 'fallback') {
          const periodEnd = existing.currentPeriodEnd;
          if (periodEnd && periodEnd < new Date()) {
            await mgr.update(Subscription, existing.id, {
              status: SubscriptionStatus.EXPIRED,
              cancelAtPeriodEnd: false,
              eventTimestampMs: incomingTs,
            });
            this.logger.log(
              `applyRcGroundTruth: EXPIRED applied for user ${userId} (period already elapsed, source=${source})`,
            );
            changed = true;
          } else {
            this.logger.warn(
              `applyRcGroundTruth_fallback_expire_skipped userId=${userId} currentPeriodEnd=${periodEnd?.toISOString() ?? 'null'} — RC drift or null expiry, not expiring`,
            );
          }
        } else {
          // source === 'cron': expire unconditionally (true revocation path).
          await mgr.update(Subscription, existing.id, {
            status: SubscriptionStatus.EXPIRED,
            cancelAtPeriodEnd: false,
            eventTimestampMs: incomingTs,
          });
          this.logger.log(
            `applyRcGroundTruth: EXPIRED applied for user ${userId} (ACTIVE→EXPIRED source=${source})`,
          );
          changed = true;
        }
      } else {
        this.logger.debug(
          `applyRcGroundTruth: no change needed for user ${userId} (source=${source})`,
        );
      }
    });
    // Emit after transaction commits so guard re-reads committed state
    if (changed) this.emitChanged(userId);
  }
}
