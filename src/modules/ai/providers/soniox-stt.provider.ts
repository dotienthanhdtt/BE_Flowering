import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import {
  SttProvider,
  SttResult,
  SttOptions,
  SttStreamHandle,
  SttStreamingProvider,
} from './stt-provider.interface';

const SONIOX_RT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_REST_URL = 'https://api.soniox.com/v1/transcribe-file';

interface SonioxToken {
  text: string;
  is_final: boolean;
  start_ms?: number;
  end_ms?: number;
}

interface SonioxResponse {
  tokens?: SonioxToken[];
  final_proc_time_ms?: number;
  error?: string;
}

/** Manages one Soniox realtime WS session, emitting partial/final transcript events. */
class SonioxStreamHandle implements SttStreamHandle {
  private partialCb?: (text: string) => void;
  private finalCb?: (text: string) => void;
  private errorCb?: (err: Error) => void;
  private closeCb?: () => void;
  private ws!: WebSocket;
  private pendingText = '';
  private resolveEnd?: () => void;
  private rejectEnd?: (err: Error) => void;
  private endPromise: Promise<void>;
  private gotLastFinal = false;
  private endRequested = false;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly language: string | undefined,
  ) {
    this.endPromise = new Promise<void>((res, rej) => {
      this.resolveEnd = res;
      this.rejectEnd = rej;
    });
  }

  connect(): this {
    this.ws = new WebSocket(SONIOX_RT_URL);

    this.ws.on('open', () => {
      const config: Record<string, unknown> = {
        api_key: this.apiKey,
        model: this.model,
        audio_format: 'pcm_s16le',
        sample_rate_hertz: 16000,
        num_channels: 1,
      };
      if (this.language) config.language_hints = [this.language];
      this.ws.send(JSON.stringify(config));
    });

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as SonioxResponse;
        if (msg.error) {
          this.errorCb?.(new Error(`Soniox error: ${msg.error}`));
          return;
        }
        if (!msg.tokens?.length) return;

        let partialAcc = '';
        let finalText = '';
        let hasFinal = false;

        for (const token of msg.tokens) {
          if (token.is_final) {
            finalText += token.text;
            hasFinal = true;
          } else {
            partialAcc += token.text;
          }
        }

        if (partialAcc) {
          this.pendingText = partialAcc;
          this.partialCb?.(this.pendingText);
        }
        if (hasFinal) {
          this.pendingText = '';
          this.finalCb?.(finalText);
          this.gotLastFinal = true;
          if (this.endRequested) {
            this.ws.close();
          }
        }
      } catch {
        // malformed message — ignore
      }
    });

    this.ws.on('error', (err: Error) => {
      this.errorCb?.(err);
      this.rejectEnd?.(err);
    });

    this.ws.on('close', () => {
      this.closeCb?.();
      this.resolveEnd?.();
    });

    return this;
  }

  pushPcm(chunk: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Soniox WS not open — cannot push PCM');
    }
    this.ws.send(chunk, { binary: true });
  }

  end(): Promise<void> {
    this.endRequested = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'finalize' }));
      if (this.gotLastFinal) {
        this.ws.close();
      }
    } else {
      this.resolveEnd?.();
    }
    return this.endPromise;
  }

  forceClose(): void {
    try {
      this.ws.terminate();
    } catch {
      // already closed
    }
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCb = cb;
  }
  onFinal(cb: (text: string) => void): void {
    this.finalCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
}

@Injectable()
export class SonioxSttProvider implements SttProvider, SttStreamingProvider {
  readonly name = 'soniox';
  readonly supportsStreaming = true as const;
  private readonly logger = new Logger(SonioxSttProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('ai.sonioxApiKey') || '';
    this.model = configService.get<string>('ai.sonioxModel') || 'stt-rt-preview';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    if (!this.isAvailable()) throw new Error('Soniox API key not configured');

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', this.model);
    if (options?.language) formData.append('language_hints', options.language);

    const response = await fetch(SONIOX_REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Soniox transcribe failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as SonioxResponse;
    const text = (data.tokens || [])
      .filter((t) => t.is_final)
      .map((t) => t.text)
      .join('');

    this.logger.log(`Soniox sync transcribed ${audio.byteLength} bytes → "${text.slice(0, 80)}"`);
    return { text };
  }

  openStream(opts: { language?: string; traceId: string }): SttStreamHandle {
    if (!this.isAvailable()) throw new Error('Soniox API key not configured');
    this.logger.log(`Opening Soniox stream traceId=${opts.traceId}`);
    return new SonioxStreamHandle(this.apiKey, this.model, opts.language).connect();
  }
}
