// Coalesce many small buffers into fewer, larger sends. First chunk always
// passes through immediately so first-byte latency is preserved. Subsequent
// chunks accumulate until either the size threshold or the time window is
// reached.
//
// Usage:
//   const c = createChunkCoalescer({ maxBytes, maxMs, onFlush });
//   stream.on('data', c.onData);
//   stream.on('end',  c.onEnd);
//   stream.on('error', c.onError); // clears pending timer
//
// `isActive()` returns false once the coalescer has been disposed via onError
// or onEnd → safe to ignore late events.

export interface ChunkCoalescerOptions {
  maxBytes: number;
  maxMs: number;
  onFlush: (buf: Buffer) => void;
  /** Called per data chunk — return false to drop (e.g. session closed). */
  shouldAccept?: () => boolean;
}

export interface ChunkCoalescer {
  onData: (chunk: Buffer) => void;
  onEnd: () => void;
  onError: () => void;
  isActive: () => boolean;
}

export function createChunkCoalescer(opts: ChunkCoalescerOptions): ChunkCoalescer {
  let buf: Buffer[] = [];
  let bytes = 0;
  let timer: NodeJS.Timeout | null = null;
  let firstFlushed = false;
  let active = true;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flushPending = (): void => {
    clearTimer();
    if (bytes === 0) return;
    const out = Buffer.concat(buf, bytes);
    buf = [];
    bytes = 0;
    if (opts.shouldAccept && !opts.shouldAccept()) return;
    opts.onFlush(out);
  };

  return {
    onData(chunk: Buffer): void {
      if (!active) return;
      if (opts.shouldAccept && !opts.shouldAccept()) return;
      if (!firstFlushed) {
        firstFlushed = true;
        opts.onFlush(chunk);
        return;
      }
      buf.push(chunk);
      bytes += chunk.length;
      if (bytes >= opts.maxBytes) {
        flushPending();
      } else if (!timer) {
        timer = setTimeout(flushPending, opts.maxMs);
      }
    },
    onEnd(): void {
      if (!active) return;
      flushPending();
      active = false;
    },
    onError(): void {
      clearTimer();
      buf = [];
      bytes = 0;
      active = false;
    },
    isActive(): boolean {
      return active;
    },
  };
}
