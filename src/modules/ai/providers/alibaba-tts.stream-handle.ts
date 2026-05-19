import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { TtsStreamHandle } from './tts-provider.interface';

// Singapore region only. Do not parameterize via env — leaks attack surface
// for SSRF-style config tampering. Beijing region uses dashscope.aliyuncs.com.
export const ALIBABA_WS_URL = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference';

export const AUDIO_FORMAT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm: 'audio/L16',
  pcm_s16le: 'audio/L16',
  opus: 'audio/opus',
};

export const SUPPORTED_FORMATS = new Set(['mp3', 'wav', 'pcm', 'pcm_s16le', 'opus']);
export const SUPPORTED_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000]);

// CosyVoice run-task `parameters.format` accepts `pcm` for raw signed 16-bit PCM.
// Gateway / Soniox use `pcm_s16le` for the same thing; normalize before send.
function normalizeFormat(fmt: string): string {
  return fmt === 'pcm_s16le' ? 'pcm' : fmt;
}

function sanitizeMessage(msg: string, apiKey: string): string {
  const noBearer = msg.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  return apiKey ? noBearer.split(apiKey).join('***') : noBearer;
}

interface CosyVoiceEvent {
  header?: {
    event?: string;
    error_code?: string;
    error_message?: string;
  };
}

export class AlibabaTtsStreamHandle implements TtsStreamHandle {
  private audioCb?: (chunk: Buffer) => void;
  private endCb?: (completed: boolean) => void;
  private errorCb?: (err: Error) => void;
  private openCb?: () => void;
  private ws!: WebSocket;
  private ended = false;
  private opened = false;
  private pendingText: string | null = null;
  private completedByProvider = false;
  private inactivityTimer?: NodeJS.Timeout;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voice: string,
    private readonly audioFormat: string,
    private readonly sampleRate: number,
    // CosyVoice infers language from voice — kept on the signature for parity
    // with the Soniox handle so the provider constructor stays uniform.
    _language: string | undefined,
    private readonly taskId: string,
    private readonly dataInspectionEnabled: boolean,
    private readonly inactivityTimeoutMs: number,
    private readonly logger: Logger,
  ) {
    void _language;
    if (!SUPPORTED_FORMATS.has(audioFormat)) {
      throw new Error(`Alibaba TTS: unsupported audioFormat=${audioFormat}`);
    }
    if (!SUPPORTED_SAMPLE_RATES.has(sampleRate)) {
      throw new Error(`Alibaba TTS: unsupported sampleRate=${sampleRate}`);
    }
  }

  connect(): this {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    // [RT-I] DataInspection is opt-in. Default off — Alibaba content moderation
    // touches sub-processor disclosure obligations.
    if (this.dataInspectionEnabled) {
      headers['X-DashScope-DataInspection'] = 'enable';
    }
    this.ws = new WebSocket(ALIBABA_WS_URL, { headers });
    this.resetInactivityTimer();

    this.ws.on('open', () => {
      this.sendRunTask();
      this.logger.log(
        `Alibaba TTS WS opened taskId=${this.taskId} model=${this.model} voice=${this.voice} fmt=${this.audioFormat}@${this.sampleRate}`,
      );
    });

    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      this.resetInactivityTimer();
      if (isBinary) {
        if (data.length > 0) this.audioCb?.(data);
        return;
      }
      const text = data.toString();
      let msg: CosyVoiceEvent;
      try {
        msg = JSON.parse(text) as CosyVoiceEvent;
      } catch {
        this.logger.warn(`Alibaba TTS unparseable message taskId=${this.taskId}`);
        return;
      }
      const event = msg.header?.event;
      switch (event) {
        case 'task-started':
          this.opened = true;
          this.openCb?.();
          if (this.pendingText !== null) {
            this.sendText(this.pendingText);
            this.sendFinish();
            this.pendingText = null;
          }
          break;
        case 'result-generated':
          break;
        case 'task-finished':
          this.completedByProvider = true;
          this.logger.log(`Alibaba TTS task-finished taskId=${this.taskId}`);
          // Close the upstream WS now that the provider is done. Without this,
          // the socket sits idle until our 15s inactivity timer terminates it
          // and synthesizes an error (which the wrapper forwards as a spurious
          // post-completion `errorCb`). Closing immediately keeps the lifecycle
          // symmetric with Soniox, which closes on `terminated`.
          try {
            this.ws?.close(1000);
          } catch {
            /* already closed */
          }
          this.finish();
          break;
        case 'task-failed': {
          const code = msg.header?.error_code ?? 'unknown';
          const errMsg = msg.header?.error_message ?? '';
          const safe = sanitizeMessage(`${code}: ${errMsg}`, this.apiKey);
          this.errorCb?.(new Error(`Alibaba TTS task-failed: ${safe}`));
          this.finish();
          break;
        }
        default:
          // Unknown event — log only.
          this.logger.debug(`Alibaba TTS unknown event=${String(event)} taskId=${this.taskId}`);
      }
    });

    this.ws.on('error', (err: Error) => {
      const safe = sanitizeMessage(err.message, this.apiKey);
      this.logger.error(`Alibaba TTS WS error taskId=${this.taskId}: ${safe}`);
      this.errorCb?.(new Error(safe));
      this.finish();
    });

    this.ws.on('close', (code: number) => {
      this.logger.log(`Alibaba TTS WS closed taskId=${this.taskId} code=${code}`);
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
    this.sendFinish();
  }

  forceClose(): void {
    // Idempotent: if provider already self-cleaned via task-finished/task-failed,
    // avoid re-terminating an in-flight close handshake — node-ws can synthesize
    // a spurious 'error' event that the gateway forwards as a post-completion
    // tts.error, poisoning metrics for a successful stream.
    if (this.ended) return;
    try {
      this.ws?.terminate();
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

  private sendRunTask(): void {
    this.send({
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: this.model,
        parameters: {
          text_type: 'PlainText',
          voice: this.voice,
          format: normalizeFormat(this.audioFormat),
          sample_rate: this.sampleRate,
          volume: 50,
          rate: 1,
          pitch: 1,
          enable_ssml: false,
        },
        input: {},
      },
    });
  }

  private sendText(text: string): void {
    this.send({
      header: { action: 'continue-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: { text } },
    });
  }

  private sendFinish(): void {
    this.send({
      header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: {} },
    });
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // [RT-F] Hard ceiling against hung WS sessions (no task-started, server stalls
  // mid-stream, etc). Reset on every inbound message; expiry → terminate + error.
  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.errorCb?.(new Error('Alibaba TTS inactivity timeout'));
      try {
        this.ws?.terminate();
      } catch {
        /* already closed */
      }
      this.finish();
    }, this.inactivityTimeoutMs);
    this.inactivityTimer.unref?.();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.endCb?.(this.completedByProvider);
  }
}
