import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  TtsOptions,
  TtsProvider,
  TtsResult,
  TtsStreamHandle,
  TtsStreamingProvider,
} from './tts-provider.interface';
import {
  AUDIO_FORMAT_TO_MIME,
  AlibabaTtsStreamHandle,
  SUPPORTED_FORMATS,
} from './alibaba-tts.stream-handle';

@Injectable()
export class AlibabaTtsProvider implements TtsProvider, TtsStreamingProvider {
  readonly name = 'alibaba-cosyvoice';
  readonly supportsStreaming = true as const;
  private readonly logger = new Logger(AlibabaTtsProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly audioFormat: string;
  private readonly sampleRate: number;
  private readonly dataInspectionEnabled: boolean;
  private readonly inactivityTimeoutMs: number;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('ai.dashscopeApiKey') || '';
    this.model = configService.get<string>('ai.alibabaTtsModel') || 'cosyvoice-v3-flash';
    this.voice = configService.get<string>('ai.alibabaTtsVoice') || 'longanyang';
    this.audioFormat = configService.get<string>('ai.alibabaTtsFormat') || 'mp3';
    this.sampleRate = configService.get<number>('ai.alibabaTtsSampleRate') || 24000;
    this.dataInspectionEnabled =
      configService.get<boolean>('ai.alibabaDataInspectionEnabled') ?? false;
    this.inactivityTimeoutMs = configService.get<number>('ai.alibabaInactivityTimeoutMs') || 15000;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  // [RT-A] Fallback wrapper calls this before promoting to Alibaba; refuses
  // promotion when client asked for a format Alibaba cannot serve.
  supportsFormat(fmt: string): boolean {
    return SUPPORTED_FORMATS.has(fmt);
  }

  get defaultMimeType(): string {
    return AUDIO_FORMAT_TO_MIME[this.audioFormat] || 'application/octet-stream';
  }

  // Exposed so the WS gateway can compute WAV headers without duplicating
  // the configured rate. Mirrors Soniox provider's surface.
  get configuredSampleRate(): number {
    return this.sampleRate;
  }

  // Single-shot synth runs the full WS lifecycle, accumulates binary frames,
  // returns a Buffer. CosyVoice has no REST API. [RT-F] inactivity timer in
  // the handle is the ultimate safety net; we still `forceClose()` in finally
  // to release the socket on every code path.
  async synthesize(text: string, opts?: TtsOptions): Promise<TtsResult> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('DASHSCOPE_API_KEY not configured');
    }
    const audioFormat = opts?.audioFormat || this.audioFormat;
    const sampleRate = opts?.sampleRate || this.sampleRate;
    let handle: AlibabaTtsStreamHandle | undefined;
    try {
      handle = this.buildHandle({
        audioFormat,
        sampleRate,
        voice: opts?.voice,
        language: opts?.language,
      });
    } catch (err) {
      throw new BadGatewayException(`Alibaba TTS init failed: ${(err as Error).message}`);
    }

    const chunks: Buffer[] = [];
    return new Promise<TtsResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          handle!.forceClose();
        } catch {
          /* idempotent */
        }
        fn();
      };
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handle!.onAudio((chunk) => chunks.push(chunk));
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handle!.onError((err) => settle(() => reject(new BadGatewayException(err.message))));
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handle!.onEnd((completed) => {
        if (!completed) {
          settle(() =>
            reject(new BadGatewayException('Alibaba TTS stream ended without completion')),
          );
          return;
        }
        settle(() => {
          const audio = Buffer.concat(chunks);
          this.logger.log(
            `Alibaba TTS synthesized ${text.length} chars → ${audio.byteLength} bytes`,
          );
          resolve({
            audio,
            mimeType: AUDIO_FORMAT_TO_MIME[audioFormat] || 'application/octet-stream',
          });
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handle!.connect();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      handle!.start(text);
    });
  }

  openStream(opts: {
    language?: string;
    voice?: string;
    traceId: string;
    audioFormat?: string;
    sampleRate?: number;
  }): TtsStreamHandle {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('DASHSCOPE_API_KEY not configured');
    }
    return this.buildHandle({
      audioFormat: opts.audioFormat || this.audioFormat,
      sampleRate: opts.sampleRate || this.sampleRate,
      voice: opts.voice,
      language: opts.language,
    }).connect();
  }

  private buildHandle(args: {
    audioFormat: string;
    sampleRate: number;
    voice?: string;
    language?: string;
  }): AlibabaTtsStreamHandle {
    return new AlibabaTtsStreamHandle(
      this.apiKey,
      this.model,
      args.voice || this.voice,
      args.audioFormat,
      args.sampleRate,
      args.language,
      randomUUID(),
      this.dataInspectionEnabled,
      this.inactivityTimeoutMs,
      this.logger,
    );
  }
}
