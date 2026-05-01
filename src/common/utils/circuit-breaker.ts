/**
 * Generic circuit breaker utility.
 *
 * States:
 *   CLOSED  — normal operation, failures counted
 *   OPEN    — tripped; calls short-circuit (fail-open: returns null)
 *   HALF_OPEN — one probe allowed after cooldown; success→CLOSED, fail→OPEN
 *
 * Fail-open semantics: when OPEN the breaker returns null so callers can
 * fall back to DB state rather than mass-revoking during RC outage.
 */
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Consecutive failures before opening (default 5) */
  failureThreshold?: number;
  /** Milliseconds to stay OPEN before half-open probe (default 5 min) */
  openDurationMs?: number;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openDurationMs: number;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private _state: BreakerState = 'CLOSED';

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openDurationMs = options.openDurationMs ?? 5 * 60 * 1000;
  }

  get state(): BreakerState {
    return this._state;
  }

  /**
   * Execute fn through the breaker.
   * Returns null (fail-open) if breaker is OPEN and cooldown not elapsed.
   * Returns null on fn error and records the failure.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    this.transitionIfNeeded();

    if (this._state === 'OPEN') {
      // Fail-open: caller continues with cached/DB answer
      return null;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch {
      this.recordFailure();
      return null;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this._state = 'CLOSED';
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this._state !== 'OPEN' && this.consecutiveFailures >= this.failureThreshold) {
      this._state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /** Check if cooldown has elapsed and move to HALF_OPEN. */
  private transitionIfNeeded(): void {
    if (
      this._state === 'OPEN' &&
      this.openedAt !== null &&
      Date.now() - this.openedAt >= this.openDurationMs
    ) {
      this._state = 'HALF_OPEN';
    }
  }
}
