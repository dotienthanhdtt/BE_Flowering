import { Injectable, Logger } from '@nestjs/common';
import { SonioxSttProvider } from '../providers/soniox-stt.provider';
import { ObjectStorageService } from '../../../database/object-storage.service';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AudioPcmBuffer } from './audio-pcm-buffer';
import { SpeechSession, SpeechContext } from './speech.types';

const UPLOAD_TIMEOUT_MS = 2000;

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  /** Single active session per principalId. */
  private readonly sessions = new Map<string, SpeechSession>();

  constructor(
    private readonly soniox: SonioxSttProvider,
    private readonly storage: ObjectStorageService,
    private readonly langfuse: LangfuseService,
  ) {}

  hasSession(principalId: string): boolean {
    return this.sessions.has(principalId);
  }

  startSession(
    principalId: string,
    traceId: string,
    language: string | undefined,
    context: SpeechContext,
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (err: Error) => void,
    onClose: () => void,
  ): SpeechSession {
    const handle = this.soniox.openStream({ language, traceId });
    const pcm = new AudioPcmBuffer();

    // Open Langfuse STT span (best-effort — do not throw if tracing fails)
    const spanId = this.openLangfuseSpan(traceId, { language, context });

    const session: SpeechSession = {
      principalId,
      traceId,
      language,
      context,
      sttHandle: handle,
      pcm,
      startedAt: new Date(),
      finals: [],
      partialCount: 0,
      langfuseSpanId: spanId,
      ending: false,
    };

    handle.onPartial((text) => {
      session.partialCount++;
      onPartial(text);
    });
    handle.onFinal((text) => {
      session.finals.push(text);
      onFinal(text);
    });
    handle.onError((err) => {
      this.logger.error(`Soniox error for principal ${principalId}: ${err.message}`);
      this.closeLangfuseSpan(session, 'error', 'provider_error');
      onError(err);
    });
    handle.onClose(() => {
      onClose();
    });

    this.sessions.set(principalId, session);
    return session;
  }

  pushAudio(session: SpeechSession, chunk: Buffer): void {
    session.pcm.push(chunk); // throws if cap exceeded
    session.sttHandle.pushPcm(chunk);
  }

  async endSession(
    session: SpeechSession,
  ): Promise<{ transcript: string; audioUrl: string | null }> {
    this.sessions.delete(session.principalId);

    try {
      await session.sttHandle.end();
    } catch (err) {
      this.logger.warn(`STT handle end error: ${String(err)}`);
    }

    const transcript = session.finals.join(' ');
    const wav = session.pcm.toWav();
    const durationMs = Date.now() - session.startedAt.getTime();

    const audioUrl = await this.uploadAudioWithTimeout(session, wav);

    this.closeLangfuseSpan(session, 'success', undefined, {
      transcript,
      audio_url: audioUrl,
      partial_count: session.partialCount,
      duration_ms: durationMs,
    });

    // Fire-and-forget background update if upload timed out
    if (audioUrl === null) {
      void this.backgroundUploadAndUpdateSpan(session, wav);
    }

    return { transcript, audioUrl };
  }

  abortSession(session: SpeechSession): void {
    this.sessions.delete(session.principalId);
    try {
      session.sttHandle.forceClose();
    } catch {
      // ignore
    }
    const durationMs = Date.now() - session.startedAt.getTime();
    this.closeLangfuseSpan(session, 'error', 'client_disconnect', { duration_ms: durationMs });
  }

  private async uploadAudioWithTimeout(
    session: SpeechSession,
    wav: Buffer,
  ): Promise<string | null> {
    try {
      const key = `${session.traceId}.wav`;
      const uploadP = this.storage.uploadAudio(wav, session.principalId, key);
      const result = await Promise.race([
        uploadP.then((r) => r.signedUrl),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), UPLOAD_TIMEOUT_MS)),
      ]);
      return result;
    } catch (err) {
      this.logger.warn(`Audio upload failed: ${String(err)}`);
      return null;
    }
  }

  private async backgroundUploadAndUpdateSpan(session: SpeechSession, wav: Buffer): Promise<void> {
    try {
      const key = `${session.traceId}.wav`;
      const { signedUrl } = await this.storage.uploadAudio(wav, session.principalId, key);
      // Re-record audio_url on span (best-effort, Langfuse event)
      if (session.langfuseSpanId) {
        this.langfuse.recordEvent(session.langfuseSpanId, 'audio_url_updated', {
          audio_url: signedUrl,
        });
      }
    } catch (err) {
      this.logger.warn(`Background audio upload failed: ${String(err)}`);
    }
  }

  private openLangfuseSpan(traceId: string, metadata: Record<string, unknown>): string | undefined {
    try {
      // Reuse conversation context API with traceId as conversationId
      this.langfuse.getConversationContext({ conversationId: traceId, ...metadata });
      // Record session start event
      this.langfuse.recordEvent(traceId, 'stt.session.start', {
        provider: 'soniox',
        language: String(metadata.language ?? 'auto'),
        context: String(metadata.context ?? 'unknown'),
      });
      return traceId;
    } catch {
      return undefined;
    }
  }

  private closeLangfuseSpan(
    session: SpeechSession,
    status: 'success' | 'error',
    reason?: string,
    output?: Record<string, unknown>,
  ): void {
    try {
      if (!session.langfuseSpanId) return;
      const attrs: Record<string, string | number | boolean> = { status };
      if (reason) attrs.reason = reason;
      if (output) {
        for (const [k, v] of Object.entries(output)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            attrs[k] = v;
          }
        }
      }
      this.langfuse.recordEvent(session.langfuseSpanId, 'stt.session.end', attrs);
    } catch {
      // tracing is best-effort
    }
  }
}
