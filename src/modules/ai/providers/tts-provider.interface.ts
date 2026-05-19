export interface TtsOptions {
  voice?: string;
  language?: string;
  audioFormat?: 'mp3' | 'wav' | 'pcm_s16le';
  sampleRate?: number;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  // Set by FallbackTtsProvider so the caller can attribute Langfuse events to
  // the provider that actually produced the audio (soniox vs alibaba-cosyvoice).
  // Optional on the base type so single-provider implementations can omit it.
  provider?: string;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, opts?: TtsOptions): Promise<TtsResult>;
  isAvailable(): boolean;
}

export interface TtsStreamHandle {
  /** Send the full text once. Provider will stream audio frames back via onAudio. */
  start(text: string): void;
  onAudio(cb: (chunk: Buffer) => void): void;
  /**
   * Fires exactly once when the stream terminates.
   * `completed=true` ⇒ provider signalled a real end-of-audio (audio_end / terminated).
   * `completed=false` ⇒ transport closed before completion (error, forceClose, network drop).
   * Only `completed=true` audio is safe to persist as a cache entry.
   */
  onEnd(cb: (completed: boolean) => void): void;
  onError(cb: (err: Error) => void): void;
  /** Optional: fires when provider's WS handshake completes (before any audio). */
  onOpen?(cb: () => void): void;
  forceClose(): void;
}

export interface TtsStreamingProvider extends TtsProvider {
  readonly supportsStreaming: true;
  openStream(opts: {
    language?: string;
    voice?: string;
    traceId: string;
    // [RT-Assumption-1] Gateway requests per-request format/rate (e.g.
    // pcm_s16le @ 24kHz for ?format=wav clients). Widened into the contract
    // so all providers implement it explicitly instead of locally widening.
    audioFormat?: string;
    sampleRate?: number;
  }): TtsStreamHandle;
  // [RT-A] Capability probe used by FallbackTtsProvider before promoting to
  // a secondary that may not support every audio format the client requested.
  supportsFormat?(fmt: string): boolean;
}
