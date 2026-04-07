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
