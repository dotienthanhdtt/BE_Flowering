import { Logger } from '@nestjs/common';
import { TtsStreamHandle, TtsStreamingProvider } from './tts-provider.interface';

export type FallbackReason = 'timeout' | 'error' | 'primary_sync_throw' | 'format_unsupported';

export interface FallbackOpenOpts {
  language?: string;
  voice?: string;
  traceId: string;
  audioFormat?: string;
  sampleRate?: number;
}

interface OnFallback {
  (reason: FallbackReason, fmt?: string): void;
}

// [RT-Review H1+H2] Consumer-facing listener used by the WS gateway to emit
// Langfuse events (`tts.fallback_fired` / `tts.fallback_aborted`). Distinct
// from the provider-internal `onFallback` callback which only logs.
export type FallbackEventListener = (event: {
  type: 'tts.fallback_fired' | 'tts.fallback_aborted';
  reason: FallbackReason;
  primary: string;
  secondary: string;
  requestedFormat?: string;
}) => void;

// Races primary vs `timeoutMs` first-audio deadline. Primary wins on first
// audio chunk; secondary wins on primary error OR deadline expiry. The
// consumer sees one stream — provider switch is transparent. Cache gating
// (completed=true only) is preserved across promotion.
export class FallbackTtsStreamHandle implements TtsStreamHandle {
  private audioCb?: (chunk: Buffer) => void;
  private endCb?: (completed: boolean) => void;
  private errorCb?: (err: Error) => void;
  private openCb?: () => void;

  private winner: 'primary' | 'secondary' | null = null;
  private primaryHandle: TtsStreamHandle | null = null;
  private secondaryHandle: TtsStreamHandle | null = null;
  private pendingText: string | null = null;
  private deadline?: NodeJS.Timeout;
  private forced = false;
  private openCbFired = false;
  private ended = false;
  // [RT-Review H1+H2] Optional event listener set by the gateway after openStream.
  // Decouples Langfuse emission from the provider (which has no event surface).
  private eventListener?: FallbackEventListener;
  // Used for the format-unsupported abort path to forward primary's real
  // error to the consumer rather than a synthesized "format mismatch" string.
  private primaryError: Error | null = null;

  constructor(
    private readonly primary: TtsStreamingProvider,
    private readonly secondary: TtsStreamingProvider | null,
    private readonly openOpts: FallbackOpenOpts,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    private readonly onFallback: OnFallback,
  ) {}

  connect(): this {
    // [RT-B] Primary openStream may throw synchronously (Soniox throws
    // ServiceUnavailableException when API key missing). Treat as immediate
    // fallback signal.
    try {
      this.primaryHandle = this.primary.openStream(this.openOpts);
    } catch (err) {
      this.primaryError = err as Error;
      this.logger.warn(`Fallback TTS: primary sync throw — ${(err as Error).message}`);
      if (!this.secondary) {
        // [RT-Review M3] Attribute the failure to the primary that threw —
        // not the misleading 'pending' state.
        this.winner = 'primary';
        // Defer the rejection so the consumer has time to register callbacks.
        queueMicrotask(() => this.errorCb?.(err as Error));
        queueMicrotask(() => this.finish(false));
        return this;
      }
      queueMicrotask(() => this.promoteToSecondary('primary_sync_throw'));
      return this;
    }
    this.wirePrimaryCallbacks();
    // Only arm the deadline if a secondary is configured; otherwise we have
    // nothing to promote to and the consumer should see primary's natural failure.
    if (this.secondary) {
      this.deadline = setTimeout(() => this.promoteToSecondary('timeout'), this.timeoutMs);
      this.deadline.unref?.();
    }
    return this;
  }

  start(text: string): void {
    // [RT-Review M4] Reject post-close to avoid resurrecting a closed handle.
    if (this.forced || this.ended) return;
    this.pendingText = text;
    if (this.winner === 'secondary' && this.secondaryHandle) {
      this.secondaryHandle.start(text);
      return;
    }
    // Send to primary preemptively even pre-settlement — primary buffers
    // internally if its WS isn't open yet. On promotion we replay to secondary.
    this.primaryHandle?.start(text);
  }

  forceClose(): void {
    // Idempotent: if already forced or naturally ended, skip — prevents
    // double-terminate of inner handles that may already have self-closed.
    if (this.forced || this.ended) return;
    // [RT-E] Hard-set forced FIRST so any in-flight deadline / micro-task
    // that hits `promoteToSecondary` after this call exits early.
    this.forced = true;
    if (this.deadline) clearTimeout(this.deadline);
    try {
      this.primaryHandle?.forceClose();
    } catch {
      /* idempotent */
    }
    try {
      this.secondaryHandle?.forceClose();
    } catch {
      /* idempotent */
    }
    this.finish(false);
  }

  // [RT-C] Per-stream provider attribution. Consumer reads this from the
  // handle (not a singleton field on the provider) to avoid concurrent-stream
  // attribution races.
  getWinnerProvider(): string {
    if (this.winner === 'primary') return this.primary.name;
    if (this.winner === 'secondary') return this.secondary?.name ?? 'unknown';
    return 'pending';
  }

  onAudio(cb: (chunk: Buffer) => void): void {
    this.audioCb = cb;
  }
  onEnd(cb: (completed: boolean) => void): void {
    this.endCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }
  // [RT-Review H1+H2] Gateway calls this immediately after openStream to
  // route fallback signals to Langfuse `tts.fallback_fired` / `tts.fallback_aborted`.
  setEventListener(listener: FallbackEventListener): void {
    this.eventListener = listener;
  }

  private wirePrimaryCallbacks(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const h = this.primaryHandle!;
    h.onAudio((chunk) => {
      if (this.winner === null && !this.forced) {
        this.winner = 'primary';
        if (this.deadline) clearTimeout(this.deadline);
        this.fireOpenOnce();
      }
      if (this.winner === 'primary') this.audioCb?.(chunk);
      // else: late audio after promotion — discard.
    });
    // [RT-D] Primary's onOpen does NOT settle the winner. First audio is the
    // real liveness signal. Skip propagation until winner determined.
    h.onOpen?.(() => {
      /* noop pre-race */
    });
    h.onError((err) => {
      this.primaryError = err;
      if (this.winner === null && !this.forced) {
        this.promoteToSecondary('error');
        return;
      }
      if (this.winner === 'primary') this.errorCb?.(err);
    });
    h.onEnd((completed) => {
      if (this.winner === 'primary') this.finish(completed);
      // pre-race or secondary winner → absorb (primary already torn down).
    });
  }

  private promoteToSecondary(reason: FallbackReason): void {
    // [RT-E] Guard against multiple promotion paths (timer + error race).
    if (this.forced || this.winner !== null) return;
    if (!this.secondary) {
      // [RT-Review M3] No fallback path — primary owns the failure.
      this.winner = 'primary';
      this.errorCb?.(this.primaryError ?? new Error('Fallback: no secondary configured'));
      this.finish(false);
      return;
    }

    // [RT-A] Refuse promotion if secondary cannot serve the requested format.
    // Prevents cache poisoning (e.g. pcm_s16le RIFF header + mp3 body).
    const requestedFmt = this.openOpts.audioFormat;
    if (
      requestedFmt &&
      this.secondary.supportsFormat &&
      !this.secondary.supportsFormat(requestedFmt)
    ) {
      this.onFallback('format_unsupported', requestedFmt);
      this.logger.warn(
        `Fallback aborted: secondary ${this.secondary.name} cannot serve format=${requestedFmt}`,
      );
      // [RT-Review H2] Langfuse event distinct from fired (aborted = secondary
      // refused; fired = secondary engaged). Dashboards filter on `type`.
      this.eventListener?.({
        type: 'tts.fallback_aborted',
        reason: 'format_unsupported',
        primary: this.primary.name,
        secondary: this.secondary.name,
        requestedFormat: requestedFmt,
      });
      // [RT-Review M3] Failure stays with the primary that the consumer
      // actually tried first — don't mislabel as 'pending'.
      this.winner = 'primary';
      this.errorCb?.(
        this.primaryError ?? new Error(`Fallback aborted: format ${requestedFmt} unsupported`),
      );
      this.finish(false);
      return;
    }

    this.winner = 'secondary';
    if (this.deadline) clearTimeout(this.deadline);
    try {
      this.primaryHandle?.forceClose();
    } catch {
      /* idempotent */
    }
    this.onFallback(reason);
    this.logger.warn(
      `tts.fallback_fired reason=${reason} primary=${this.primary.name} secondary=${this.secondary.name}`,
    );
    // [RT-Review H1] Langfuse event for rate-alerting dashboards.
    this.eventListener?.({
      type: 'tts.fallback_fired',
      reason,
      primary: this.primary.name,
      secondary: this.secondary.name,
    });

    try {
      this.secondaryHandle = this.secondary.openStream(this.openOpts);
    } catch (err) {
      this.errorCb?.(err as Error);
      this.finish(false);
      return;
    }
    this.wireSecondaryCallbacks();
    if (this.pendingText !== null) this.secondaryHandle.start(this.pendingText);
  }

  private wireSecondaryCallbacks(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const h = this.secondaryHandle!;
    h.onAudio((chunk) => {
      this.fireOpenOnce();
      this.audioCb?.(chunk);
    });
    h.onOpen?.(() => this.fireOpenOnce());
    h.onError((err) => this.errorCb?.(err));
    h.onEnd((completed) => this.finish(completed));
  }

  // [RT-D] Consumer onOpen fires exactly once on winner determination.
  private fireOpenOnce(): void {
    if (this.openCbFired) return;
    this.openCbFired = true;
    this.openCb?.();
  }

  private finish(completed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    if (this.deadline) clearTimeout(this.deadline);
    this.endCb?.(completed);
  }
}
