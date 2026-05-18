export interface SttResult {
  text: string;
}

export interface SttOptions {
  language?: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult>;
  isAvailable(): boolean;
}

export interface SttStreamHandle {
  pushPcm(chunk: Buffer): void;
  end(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
  forceClose(): void;
}

export interface SttStreamingProvider extends SttProvider {
  readonly supportsStreaming: true;
  openStream(opts: { language?: string; traceId: string }): SttStreamHandle;
}
