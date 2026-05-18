export interface TtsOptions {
  voice?: string;
  language?: string;
  audioFormat?: 'mp3' | 'wav' | 'pcm_s16le';
  sampleRate?: number;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
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
  openStream(opts: { language?: string; voice?: string; traceId: string }): TtsStreamHandle;
}
