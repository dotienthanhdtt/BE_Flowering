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
  private endCb?: (completed: boolean) => void;
  private errorCb?: (err: Error) => void;
  private openCb?: () => void;
  private ws!: WebSocket;
  private ended = false;
  private opened = false;
  private pendingText: string | null = null;
  private audioChunksSeen = 0;
  private nonAudioMessagesSeen = 0;
  // True only when Soniox emitted audio_end or terminated — i.e. the
  // server affirmed full audio was delivered. Transport close alone does
  // NOT set this flag, so partial streams remain marked incomplete.
  private completedByProvider = false;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voice: string,
    private readonly audioFormat: string,
    private readonly sampleRate: number,
    private readonly language: string | undefined,
    private readonly streamId: string,
    private readonly logger: Logger,
  ) {}

  connect(): this {
    this.ws = new WebSocket(SONIOX_TTS_WS_URL);

    this.ws.on('open', () => {
      // Soniox WS requires: api_key, stream_id, model, language, voice, audio_format.
      // Missing any required field → server TCP-drops with no error JSON (close 1006).
      const language = this.language || 'en';
      const config: Record<string, unknown> = {
        api_key: this.apiKey,
        model: this.model,
        language,
        voice: this.voice,
        audio_format: this.audioFormat,
        sample_rate: this.sampleRate,
        stream_id: this.streamId,
      };
      this.ws.send(JSON.stringify(config));
      this.opened = true;
      this.openCb?.();
      this.logger.log(
        `Soniox TTS WS opened streamId=${this.streamId} model=${this.model} voice=${this.voice} lang=${language} format=${this.audioFormat}@${this.sampleRate}`,
      );
      if (this.pendingText !== null) {
        this.sendText(this.pendingText);
        this.pendingText = null;
      }
    });

    this.ws.on('message', (data: Buffer | string, isBinary?: boolean) => {
      // Binary frames not expected per Soniox docs (audio is base64 in JSON),
      // but log if they ever appear so we can detect protocol drift.
      if (isBinary && Buffer.isBuffer(data)) {
        this.logger.warn(
          `Soniox TTS unexpected binary frame streamId=${this.streamId} size=${data.length}`,
        );
        if (data.length > 0) {
          this.audioChunksSeen++;
          this.audioCb?.(data);
        }
        return;
      }
      const text = typeof data === 'string' ? data : data.toString();
      let msg: { audio?: string; audio_end?: boolean; terminated?: boolean; error?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        this.logger.warn(
          `Soniox TTS unparseable message streamId=${this.streamId} preview=${text.slice(0, 120)}`,
        );
        return;
      }
      if (msg.error) {
        this.logger.error(`Soniox TTS error streamId=${this.streamId}: ${msg.error}`);
        this.errorCb?.(new Error(`Soniox TTS error: ${msg.error}`));
        return;
      }
      if (msg.audio) {
        const buf = Buffer.from(msg.audio, 'base64');
        if (buf.length > 0) {
          this.audioChunksSeen++;
          this.audioCb?.(buf);
        }
      } else {
        this.nonAudioMessagesSeen++;
      }
      if (msg.audio_end) {
        this.completedByProvider = true;
        this.logger.log(
          `Soniox TTS audio_end streamId=${this.streamId} chunks=${this.audioChunksSeen}`,
        );
      }
      if (msg.terminated) {
        this.completedByProvider = true;
        this.logger.log(
          `Soniox TTS terminated streamId=${this.streamId} chunks=${this.audioChunksSeen} nonAudioMsgs=${this.nonAudioMessagesSeen}`,
        );
        this.finish();
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`Soniox TTS WS transport error streamId=${this.streamId}: ${err.message}`);
      this.errorCb?.(err);
      this.finish();
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.logger.log(
        `Soniox TTS WS closed streamId=${this.streamId} code=${code} reason=${reason?.toString().slice(0, 200) || ''} chunks=${this.audioChunksSeen}`,
      );
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
  onEnd(cb: (completed: boolean) => void): void {
    this.endCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.endCb?.(this.completedByProvider);
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
      this.logger,
    ).connect();
  }
}
