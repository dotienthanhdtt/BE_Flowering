import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import {
  TtsOptions,
  TtsProvider,
  TtsResult,
  TtsStreamHandle,
  TtsStreamingProvider,
} from './tts-provider.interface';

const SONIOX_TTS_REST_URL = 'https://tts-rt.soniox.com/tts';
const SONIOX_TTS_WS_URL = 'wss://tts-rt.soniox.com/tts-websocket';

const AUDIO_FORMAT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm_s16le: 'audio/L16',
};

/** Manages one Soniox TTS realtime WS session, emitting audio chunks. */
class SonioxTtsStreamHandle implements TtsStreamHandle {
  private audioCb?: (chunk: Buffer) => void;
  private endCb?: () => void;
  private errorCb?: (err: Error) => void;
  private ws!: WebSocket;
  private ended = false;
  private opened = false;
  private pendingText: string | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voice: string,
    private readonly audioFormat: string,
    private readonly sampleRate: number,
    private readonly language: string | undefined,
    private readonly streamId: string,
  ) {}

  connect(): this {
    this.ws = new WebSocket(SONIOX_TTS_WS_URL);

    this.ws.on('open', () => {
      const config: Record<string, unknown> = {
        api_key: this.apiKey,
        model: this.model,
        voice: this.voice,
        audio_format: this.audioFormat,
        sample_rate: this.sampleRate,
        stream_id: this.streamId,
      };
      if (this.language) config.language = this.language;
      this.ws.send(JSON.stringify(config));
      this.opened = true;
      if (this.pendingText !== null) {
        this.sendText(this.pendingText);
        this.pendingText = null;
      }
    });

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString();
        const msg = JSON.parse(text) as {
          audio?: string;
          audio_end?: boolean;
          terminated?: boolean;
          error?: string;
        };
        if (msg.error) {
          this.errorCb?.(new Error(`Soniox TTS error: ${msg.error}`));
          return;
        }
        if (msg.audio) {
          const buf = Buffer.from(msg.audio, 'base64');
          if (buf.length > 0) this.audioCb?.(buf);
        }
        if (msg.terminated) {
          this.finish();
        }
      } catch {
        // malformed message — ignore
      }
    });

    this.ws.on('error', (err: Error) => {
      this.errorCb?.(err);
      this.finish();
    });

    this.ws.on('close', () => {
      this.finish();
    });

    return this;
  }

  start(text: string): void {
    if (!this.opened) {
      this.pendingText = text;
      return;
    }
    this.sendText(text);
  }

  private sendText(text: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ text, text_end: true, stream_id: this.streamId }));
  }

  forceClose(): void {
    try {
      this.ws.terminate();
    } catch {
      // already closed
    }
    this.finish();
  }

  onAudio(cb: (chunk: Buffer) => void): void {
    this.audioCb = cb;
  }
  onEnd(cb: () => void): void {
    this.endCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.endCb?.();
  }
}

@Injectable()
export class SonioxTtsProvider implements TtsProvider, TtsStreamingProvider {
  readonly name = 'soniox';
  readonly supportsStreaming = true as const;
  private readonly logger = new Logger(SonioxTtsProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly audioFormat: string;
  private readonly sampleRate: number;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('ai.sonioxApiKey') || '';
    this.model = configService.get<string>('ai.sonioxTtsModel') || 'tts-rt-v1';
    this.voice = configService.get<string>('ai.sonioxTtsVoice') || 'Adrian';
    this.audioFormat = configService.get<string>('ai.sonioxTtsAudioFormat') || 'mp3';
    this.sampleRate = configService.get<number>('ai.sonioxTtsSampleRate') || 24000;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  get defaultMimeType(): string {
    return AUDIO_FORMAT_TO_MIME[this.audioFormat] || 'application/octet-stream';
  }

  async synthesize(text: string, opts?: TtsOptions): Promise<TtsResult> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('Soniox API key not configured');
    }

    const audioFormat = opts?.audioFormat || this.audioFormat;
    const body: Record<string, unknown> = {
      model: this.model,
      voice: opts?.voice || this.voice,
      audio_format: audioFormat,
      sample_rate: opts?.sampleRate || this.sampleRate,
      text,
    };
    if (opts?.language) body.language = opts.language;

    const response = await fetch(SONIOX_TTS_REST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = (await response.text()).slice(0, 500);
      throw new BadGatewayException(`Soniox TTS failed: ${response.status} ${errBody}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    this.logger.log(
      `Soniox TTS synthesized ${text.length} chars → ${audio.byteLength} bytes (${audioFormat})`,
    );
    return { audio, mimeType: AUDIO_FORMAT_TO_MIME[audioFormat] || 'application/octet-stream' };
  }

  openStream(opts: { language?: string; voice?: string; traceId: string }): TtsStreamHandle {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('Soniox API key not configured');
    }
    this.logger.log(`Opening Soniox TTS stream traceId=${opts.traceId}`);
    return new SonioxTtsStreamHandle(
      this.apiKey,
      this.model,
      opts.voice || this.voice,
      this.audioFormat,
      this.sampleRate,
      opts.language,
      opts.traceId,
    ).connect();
  }
}
