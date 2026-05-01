/**
 * Unit tests for CircuitBreaker utility.
 *
 * Validates state transitions:
 *   CLOSED → OPEN after failureThreshold consecutive failures
 *   OPEN   → HALF_OPEN after openDurationMs cooldown
 *   HALF_OPEN → CLOSED on probe success
 *   HALF_OPEN → OPEN on probe failure
 *
 * Fail-open semantics: execute() returns null when OPEN (never throws).
 */
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  const FAILURE_THRESHOLD = 3;
  const OPEN_DURATION_MS = 200; // short for tests

  function makeBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      openDurationMs: OPEN_DURATION_MS,
    });
  }

  // ── State basics ──────────────────────────────────────────────────────────

  it('starts CLOSED', () => {
    expect(makeBreaker().state).toBe('CLOSED');
  });

  it('stays CLOSED below failure threshold', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }
    expect(cb.state).toBe('CLOSED');
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }
    expect(cb.state).toBe('OPEN');
  });

  it('resets failure count and returns CLOSED on success', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.state).toBe('CLOSED');
  });

  // ── Fail-open semantics ───────────────────────────────────────────────────

  it('returns null (fail-open) when OPEN — fn is NOT called', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }
    expect(cb.state).toBe('OPEN');

    const fn = jest.fn().mockResolvedValue('should-not-be-called');
    const result = await cb.execute(fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns null (not throwing) when fn rejects', async () => {
    const cb = makeBreaker();
    const result = await cb.execute(() => Promise.reject(new Error('boom')));
    expect(result).toBeNull();
  });

  it('returns fn result when CLOSED and fn resolves', async () => {
    const cb = makeBreaker();
    const result = await cb.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  // ── HALF_OPEN transition ──────────────────────────────────────────────────

  it('transitions OPEN → HALF_OPEN after cooldown', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }
    expect(cb.state).toBe('OPEN');

    await new Promise((r) => setTimeout(r, OPEN_DURATION_MS + 20));

    // Trigger transition check via execute
    const fn = jest.fn().mockResolvedValue('probe');
    const result = await cb.execute(fn);

    // In HALF_OPEN the probe is allowed
    expect(fn).toHaveBeenCalled();
    expect(result).toBe('probe');
    expect(cb.state).toBe('CLOSED');
  });

  it('HALF_OPEN → OPEN again on probe failure', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await cb.execute(() => Promise.reject(new Error('fail')));
    }

    await new Promise((r) => setTimeout(r, OPEN_DURATION_MS + 20));

    // probe fails
    await cb.execute(() => Promise.reject(new Error('probe-fail')));
    expect(cb.state).toBe('OPEN');
  });

  // ── recordSuccess / recordFailure direct API ──────────────────────────────

  it('recordSuccess resets to CLOSED from OPEN', async () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      cb.recordFailure();
    }
    expect(cb.state).toBe('OPEN');
    cb.recordSuccess();
    expect(cb.state).toBe('CLOSED');
  });

  it('recordFailure increments without crossing threshold stays CLOSED', () => {
    const cb = makeBreaker();
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      cb.recordFailure();
    }
    expect(cb.state).toBe('CLOSED');
  });

  // ── 6th call short-circuits ───────────────────────────────────────────────

  it('6th call short-circuits without hitting fn after 5 failures (spec requirement)', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 60_000 });
    const failFn = jest.fn().mockRejectedValue(new Error('rc-down'));

    for (let i = 0; i < 5; i++) {
      await cb.execute(failFn);
    }
    expect(failFn).toHaveBeenCalledTimes(5);
    expect(cb.state).toBe('OPEN');

    const result = await cb.execute(failFn);
    expect(result).toBeNull();
    // fn was NOT called on 6th attempt
    expect(failFn).toHaveBeenCalledTimes(5);
  });
});
