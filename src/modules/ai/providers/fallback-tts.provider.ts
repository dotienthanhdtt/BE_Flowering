import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SonioxTtsProvider } from './soniox-tts.provider';
import { AlibabaTtsProvider } from './alibaba-tts.provider';
import {
  TtsOptions,
  TtsProvider,
  TtsResult,
  TtsStreamHandle,
  TtsStreamingProvider,
} from './tts-provider.interface';
import { FallbackTtsStreamHandle } from './fallback-tts.stream-handle';

// Wraps Soniox (primary) + Alibaba (secondary) with a 3s first-audio
// fallback race. Exposes the same shape as the underlying primary so
// TtsService / TtsGateway can swap their concrete-type injection
// (SonioxTtsProvider → FallbackTtsProvider) without API changes beyond
// `name` (moved to per-stream `getWinnerProvider()` on the handle).
@Injectable()
export class FallbackTtsProvider implements TtsProvider, TtsStreamingProvider {
  readonly name = 'tts-fallback';
  readonly supportsStreaming = true as const;
  private readonly logger = new Logger(FallbackTtsProvider.name);
  private readonly fallbackEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly synthTimeoutMs = 5000;
  private readonly defaultFormat: string;

  constructor(
    private readonly primary: SonioxTtsProvider,
    private readonly secondary: AlibabaTtsProvider,
    configService: ConfigService,
  ) {
    this.fallbackEnabled = configService.get<boolean>('ai.ttsFallbackEnabled') ?? true;
    this.timeoutMs = configService.get<number>('ai.ttsFallbackTimeoutMs') || 3000;
    this.defaultFormat = configService.get<string>('ai.alibabaTtsFormat') || 'mp3';

    // [RT-K] Surface silent-misconfig at boot. Fallback enabled but Alibaba
    // unavailable means every Soniox outage will degrade to user-facing
    // errors with no audio — operators want to know now, not at 3am.
    if (this.fallbackEnabled && !this.secondary.isAvailable()) {
      this.logger.error('TTS fallback enabled but DASHSCOPE_API_KEY missing — fallback inactive');
    }
  }

  isAvailable(): boolean {
    return this.primary.isAvailable() || this.secondary.isAvailable();
  }

  // Delegated to primary — both providers configured to the same default
  // (mp3 @ 24kHz). Per-request overrides plumbed via opts; gateway uses
  // these getters only for WAV header math on the cache_hit path.
  get defaultMimeType(): string {
    return this.primary.defaultMimeType;
  }
  get configuredSampleRate(): number {
    return this.primary.configuredSampleRate;
  }

  // Wrapper supports a format if either underlying provider supports it.
  // Both providers now expose `supportsFormat` (RT-Review M2 added it to Soniox).
  supportsFormat(fmt: string): boolean {
    return (this.primary.supportsFormat?.(fmt) ?? false) || this.secondary.supportsFormat(fmt);
  }

  // [RT-Review M1] Exposed for the gateway's resolveProvider() so direct-
  // passthrough handles (no race) get the underlying provider name instead
  // of the wrapper's 'tts-fallback' label.
  get primaryName(): string {
    return this.primary.name;
  }
  get secondaryName(): string {
    return this.secondary.name;
  }

  async synthesize(text: string, opts?: TtsOptions): Promise<TtsResult> {
    const fmt = opts?.audioFormat || this.defaultFormat;
    // [RT-Review M2] Symmetric format gating — primary and secondary both
    // checked for format support, not just availability.
    const primaryUsable =
      this.primary.isAvailable() && (this.primary.supportsFormat?.(fmt) ?? true);
    const secondaryUsable = this.secondary.isAvailable() && this.secondary.supportsFormat(fmt);

    if (!primaryUsable) {
      if (!secondaryUsable) {
        throw new ServiceUnavailableException('No TTS provider available for requested format');
      }
      return this.tag(await this.secondary.synthesize(text, opts), this.secondary.name);
    }

    if (!secondaryUsable || !this.fallbackEnabled) {
      return this.tag(await this.primary.synthesize(text, opts), this.primary.name);
    }

    // [RT-F] withTimeout wraps the primary call; if it stalls past the
    // synth budget, we promote to Alibaba. Inner Alibaba synth has its own
    // inactivity timer in AlibabaTtsStreamHandle.
    try {
      const result = await this.withTimeout(
        this.primary.synthesize(text, opts),
        this.synthTimeoutMs,
      );
      return this.tag(result, this.primary.name);
    } catch (err) {
      // [RT-Review H1] Stream path emits Langfuse `tts.fallback_fired` via the
      // handle's eventListener. Synth path has no handle; emit a structured
      // hook so consumers (TtsService) can call `langfuse.recordEvent` if they
      // care. For now, the warn-log remains the audit trail until we add a
      // synth-side event surface.
      this.logger.warn(
        `tts.fallback_fired type=synth reason=${(err as Error).message} primary=${this.primary.name} secondary=${this.secondary.name}`,
      );
      return this.tag(await this.secondary.synthesize(text, opts), this.secondary.name);
    }
  }

  openStream(opts: {
    language?: string;
    voice?: string;
    traceId: string;
    audioFormat?: string;
    sampleRate?: number;
  }): TtsStreamHandle {
    const fmt = opts.audioFormat || this.defaultFormat;
    // [RT-Review M2] Symmetric format gating for stream path too.
    const primaryUsable =
      this.primary.isAvailable() && (this.primary.supportsFormat?.(fmt) ?? true);
    const secondaryUsable = this.secondary.isAvailable() && this.secondary.supportsFormat(fmt);

    if (!primaryUsable && !secondaryUsable) {
      throw new ServiceUnavailableException('No TTS provider available for requested format');
    }
    if (!primaryUsable) {
      return this.secondary.openStream(opts);
    }
    if (!secondaryUsable || !this.fallbackEnabled) {
      return this.primary.openStream(opts);
    }
    return new FallbackTtsStreamHandle(
      this.primary,
      this.secondary,
      opts,
      this.timeoutMs,
      this.logger,
      (reason, format) => {
        // Hook for observability — caller can also read getWinnerProvider()
        // off the handle once the race settles.
        this.logger.log(`Fallback signal: reason=${reason}${format ? ` format=${format}` : ''}`);
      },
    ).connect();
  }

  private tag(result: TtsResult, provider: string): TtsResult {
    return { ...result, provider };
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Primary synth timeout after ${ms}ms`)), ms);
      timer.unref?.();
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
