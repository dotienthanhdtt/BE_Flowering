/**
 * RevenueCat REST API v1 client.
 * Used for read-time fallback and nightly reconciliation.
 * Rate limit: 100 req/min/project — only called on DB miss or cron batch.
 *
 * SECURITY: Authorization header is NEVER logged; pass redactHeaders=true
 * to any HTTP logger interceptor.
 */
import * as https from 'https';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface RcEntitlementInfo {
  isActive: boolean;
  expiresAtMs: number | null;
  productId: string | null;
  purchasedAtMs: number | null;
}

export interface RcSubscriberPayload {
  appUserId: string;
  /** Map of entitlement identifier → entitlement info */
  entitlements: Record<string, RcEntitlementInfo>;
  /** True if any entitlement is currently active */
  hasActiveEntitlement: boolean;
  /** The first active entitlement's expiry ms, or null */
  activeExpiresAtMs: number | null;
  /** Raw product identifier from the active subscription, or null */
  activeProductId: string | null;
  /** Epoch ms at time of fetch — used as event_timestamp_ms for applyRcGroundTruth */
  fetchedAtMs: number;
}

// ─── Internal RC API shape (only fields we use) ───────────────────────────────

interface RcEntitlementRaw {
  expires_date: string | null;
  purchase_date: string | null;
  product_identifier: string | null;
}

interface RcSubscriberRaw {
  subscriber: {
    entitlements: Record<string, RcEntitlementRaw>;
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

@Injectable()
export class RevenueCatRestClient implements OnModuleInit {
  private readonly logger = new Logger(RevenueCatRestClient.name);
  private readonly apiKey: string;
  private readonly timeoutMs = 5_000;

  constructor() {
    this.apiKey = process.env.REVENUECAT_REST_API_KEY ?? '';
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'production' && !this.apiKey) {
      throw new Error('REVENUECAT_REST_API_KEY must be set in production. Aborting startup.');
    }
    if (!this.apiKey) {
      this.logger.warn('REVENUECAT_REST_API_KEY not set — RC REST fallback disabled');
    }
  }

  /**
   * Fetch subscriber data from RC REST API.
   * Returns null on any error (network, 4xx, 5xx) — caller handles fail-open.
   * Never throws.
   */
  async getSubscriber(appUserId: string): Promise<RcSubscriberPayload | null> {
    if (!this.apiKey) return null;

    try {
      const raw = await this.fetchRaw(appUserId);
      return this.normalize(appUserId, raw);
    } catch (err) {
      // Log without exposing any auth details
      this.logger.error(`RC REST getSubscriber failed for ${appUserId}: ${(err as Error).message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private fetchRaw(appUserId: string): Promise<RcSubscriberRaw> {
    return new Promise((resolve, reject) => {
      const path = `/v1/subscribers/${encodeURIComponent(appUserId)}`;
      const options: https.RequestOptions = {
        hostname: 'api.revenuecat.com',
        port: 443,
        path,
        method: 'GET',
        // Authorization is intentionally NOT logged anywhere
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // X-Platform is NOT required by the RC v1 GET /subscribers endpoint per public docs.
          // Removed to avoid sending an incorrect/undocumented header.
        },
        timeout: this.timeoutMs,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 404) {
            // User has no RC record — treat as no active entitlement
            resolve({ subscriber: { entitlements: {} } });
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`RC REST HTTP ${res.statusCode ?? 'unknown'}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as RcSubscriberRaw);
          } catch {
            reject(new Error(`RC REST invalid JSON response`));
          }
        });
        res.on('error', reject);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`RC REST request timed out after ${this.timeoutMs}ms`));
      });

      req.on('error', reject);
      req.end();
    });
  }

  private normalize(appUserId: string, raw: RcSubscriberRaw): RcSubscriberPayload {
    const now = Date.now();
    const entitlements: Record<string, RcEntitlementInfo> = {};

    for (const [key, ent] of Object.entries(raw.subscriber.entitlements)) {
      const expiresAtMs = ent.expires_date ? new Date(ent.expires_date).getTime() : null;
      const isActive = expiresAtMs === null || expiresAtMs > now;
      entitlements[key] = {
        isActive,
        expiresAtMs,
        productId: ent.product_identifier,
        purchasedAtMs: ent.purchase_date ? new Date(ent.purchase_date).getTime() : null,
      };
    }

    const activeEntries = Object.values(entitlements).filter((e) => e.isActive);

    /**
     * Pick the "primary" active entitlement deterministically:
     *   1. Sort by `purchasedAtMs` descending — most-recent purchase wins (e.g. after an upgrade).
     *   2. Tie-break by `productId` ascending (lexical) — deterministic across RC API calls
     *      when two entitlements share the same purchase timestamp (edge case, e.g. promo grants).
     * This avoids non-deterministic selection when multiple entitlements are active simultaneously.
     */
    const sortedActive = [...activeEntries].sort((a, b) => {
      const tsDiff = (b.purchasedAtMs ?? 0) - (a.purchasedAtMs ?? 0);
      if (tsDiff !== 0) return tsDiff;
      return (a.productId ?? '').localeCompare(b.productId ?? '');
    });
    const primaryActive = sortedActive[0] ?? null;

    return {
      appUserId,
      entitlements,
      hasActiveEntitlement: activeEntries.length > 0,
      activeExpiresAtMs: primaryActive?.expiresAtMs ?? null,
      activeProductId: primaryActive?.productId ?? null,
      fetchedAtMs: now,
    };
  }
}
