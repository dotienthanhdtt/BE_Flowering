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
  onEnd(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  forceClose(): void;
}

export interface TtsStreamingProvider extends TtsProvider {
  readonly supportsStreaming: true;
  openStream(opts: { language?: string; voice?: string; traceId: string }): TtsStreamHandle;
}
