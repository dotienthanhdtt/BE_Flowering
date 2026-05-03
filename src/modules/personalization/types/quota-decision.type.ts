export type QuotaReason = 'ok' | 'paywall' | 'daily_ceiling' | 'free_blocked';

export interface QuotaDecision {
  allowed: boolean;
  reason: QuotaReason;
  /** Only present when reason='ok' and user is on PREMIUM (monthly trial) */
  quotaRemaining?: number;
}
