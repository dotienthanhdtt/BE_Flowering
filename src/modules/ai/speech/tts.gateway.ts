import { Logger } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { WsAuthGuard } from './ws-auth.guard';
import { TtsService, TtsPrincipal } from './tts.service';
import { FallbackTtsProvider } from '../providers/fallback-tts.provider';
import { FallbackTtsStreamHandle } from '../providers/fallback-tts.stream-handle';
import { ObjectStorageService } from '../../../database/object-storage.service';
import { TtsStreamHandle } from '../providers/tts-provider.interface';
import { createChunkCoalescer } from './chunk-coalescer';
import { buildFinalizedWavHeader, buildStreamingWavHeader, WavPcmFormat } from './wav-header';

// Client opt-in: `?format=wav` switches the live path from MP3 to streaming
// PCM-in-WAV. MP3 stays the default so older clients still work.
type OutputFormat = 'mp3' | 'wav';
const PCM_FORMAT: WavPcmFormat = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

const MAX_DURATION_MS = 60_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ActiveSession {
  handle?: TtsStreamHandle;
  timer?: ReturnType<typeof setTimeout>;
  chunks: Buffer[];
  firstChunkAt?: number;
  startedAt: number;
  closed: boolean;
  persisted: boolean;
  // True only after Soniox emitted `onEnd` — i.e. the full TTS was
  // synthesized. Required to gate cache persistence: persisting partial
  // streams on early disconnect poisons the cache and replays only the
  // first words on subsequent loads.
  providerCompleted: boolean;
  // Output format negotiated with the client. `wav` streams PCM with a
  // synthetic RIFF header prepended to chunk #1 so the player can start
  // immediately; `mp3` keeps the legacy passthrough path.
  outputFormat: OutputFormat;
  headerSent: boolean;
  message?: { id: string; conversationId: string; content: string };
  principal?: TtsPrincipal;
}

const clientSessions = new WeakMap<WebSocket, ActiveSession>();

@WebSocketGateway({ path: '/ws/speech/tts' })
export class TtsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TtsGateway.name);

  // Coalesce R2 cache stream into larger WS frames. First chunk always
  // passes through immediately to preserve cache first-byte latency.
  private static readonly CACHE_COALESCE_MAX_BYTES = 64 * 1024;
  private static readonly CACHE_COALESCE_MAX_MS = 20;

  constructor(
    private readonly auth: WsAuthGuard,
    private readonly tts: TtsService,
    private readonly ttsProvider: FallbackTtsProvider,
    private readonly storage: ObjectStorageService,
  ) {}

  // [RT-C] Resolve the provider that produced (or will produce) this stream's
  // audio. Returns 'pending' until the race settles, then the winner's name.
  // [RT-Review M1] For direct-passthrough handles (fallback disabled / only
  // one provider configured / format-unsupported skip), return the primary's
  // real name — not the wrapper's 'tts-fallback' label.
  private resolveProvider(handle: TtsStreamHandle | undefined): string {
    if (!handle) return 'pending';
    if (handle instanceof FallbackTtsStreamHandle) return handle.getWinnerProvider();
    return this.ttsProvider.primaryName;
  }

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const tConnect = Date.now();
    const authResult = this.auth.validate(req);
    if (!authResult) {
      this.closeWithError(client, 4401, 'auth', 'Unauthorized');
      return;
    }

    const url = new URL(req.url || '', 'ws://localhost');
    const messageId = url.searchParams.get('messageId');
    if (!messageId || !UUID_V4.test(messageId)) {
      this.closeWithError(client, 4400, 'bad_request', 'messageId required');
      return;
    }
    const outputFormat: OutputFormat = url.searchParams.get('format') === 'wav' ? 'wav' : 'mp3';

    const principal = this.buildPrincipal(authResult, url);
    if (!principal) {
      this.closeWithError(client, 4400, 'bad_request', 'conversationId required for onboarding');
      return;
    }

    const tAuthStart = Date.now();
    let message;
    try {
      message = await this.tts.loadAndAuthorize(messageId, principal);
    } catch (err) {
      this.handleAuthError(client, err);
      return;
    }
    const loadAuthMs = Date.now() - tAuthStart;

    const session: ActiveSession = {
      chunks: [],
      startedAt: Date.now(),
      closed: false,
      persisted: false,
      providerCompleted: false,
      outputFormat,
      headerSent: false,
      message: {
        id: message.id,
        conversationId: message.conversationId,
        content: message.content,
      },
      principal,
    };
    clientSessions.set(client, session);

    session.timer = setTimeout(() => {
      this.closeWithError(client, 4408, 'max_duration', 'Max duration reached');
      this.cleanup(client);
    }, MAX_DURATION_MS);
    if (session.timer.unref) session.timer.unref();

    const language = this.tts.resolveLanguage(message.conversation);

    // Cache hit → fetch stored mp3, stream once, end. [RT-C] cache provider
    // is unknowable post-hoc; emit 'cache' rather than guessing a name.
    if (message.audioUrl) {
      this.tts.emitEvent(message.conversationId, 'tts.cache_hit', {
        message_id: message.id,
        provider: 'cache',
        transport: 'ws',
        language,
        load_auth_ms: loadAuthMs,
      });
      this.logger.log(`[tts-timing] cache_hit messageId=${messageId} loadAuthMs=${loadAuthMs}`);
      await this.streamFromStorage(client, session, message.audioUrl, tConnect);
      return;
    }

    // Cache miss → open TTS stream via fallback wrapper (Soniox primary +
    // Alibaba secondary). For `wav` we ask for raw PCM_S16LE and wrap it
    // ourselves; the player gets a known format from the RIFF header in the
    // first WS frame and avoids MP3's two-phase codec init (the "plays twice"
    // bug on Android). [RT-A] If the wrapper cannot serve pcm_s16le from
    // secondary, it stays on primary — no corrupt cross-format audio.
    const tTtsOpen = Date.now();
    try {
      const handle = this.ttsProvider.openStream({
        traceId: message.conversationId,
        language,
        audioFormat: outputFormat === 'wav' ? 'pcm_s16le' : undefined,
        sampleRate: outputFormat === 'wav' ? PCM_FORMAT.sampleRate : undefined,
      });
      session.handle = handle;

      // [RT-Review H1+H2] Route fallback signals to Langfuse so dashboards can
      // alert on fallback rate (fired) and refused-fallback errors (aborted).
      if (handle instanceof FallbackTtsStreamHandle) {
        handle.setEventListener((event) => {
          this.tts.emitEvent(message.conversationId, event.type, {
            message_id: message.id,
            reason: event.reason,
            primary: event.primary,
            secondary: event.secondary,
            ...(event.requestedFormat ? { requested_format: event.requestedFormat } : {}),
          });
        });
      }

      // [RT-D] For FallbackTtsStreamHandle, onOpen fires once on winner
      // settlement; for direct providers, it fires on WS handshake. Either
      // way, this metric reflects connect-time to the actual producer.
      handle.onOpen?.(() => {
        const ttsConnectMs = Date.now() - tTtsOpen;
        const provider = this.resolveProvider(handle);
        this.logger.log(
          `[tts-timing] tts_ws_open messageId=${messageId} ttsConnectMs=${ttsConnectMs} provider=${provider}`,
        );
        // [RT-Assumption-6] Dual-emit during dashboard migration window: keep
        // legacy soniox_connect_ms AND new tts_connect_ms with same value.
        this.tts.emitEvent(message.conversationId, 'tts.stream_ws_open', {
          message_id: message.id,
          provider,
          soniox_connect_ms: ttsConnectMs,
          tts_connect_ms: ttsConnectMs,
        });
      });

      handle.onAudio((chunk) => {
        // Always buffer for cache persistence — even if the client is gone.
        // The goal is to store the full audio of this message no matter
        // what happens on the client side. Only forwarding to the WS client
        // is gated on socket state.
        if (!session.firstChunkAt) {
          session.firstChunkAt = Date.now();
          const totalFirstChunkMs = session.firstChunkAt - tConnect;
          const ttsFirstAudioMs = session.firstChunkAt - tTtsOpen;
          const provider = this.resolveProvider(handle);
          this.logger.log(
            `[tts-timing] first_chunk messageId=${messageId} provider=${provider} loadAuthMs=${loadAuthMs} ttsFirstAudioMs=${ttsFirstAudioMs} totalFirstChunkMs=${totalFirstChunkMs} chars=${message.content.length}`,
          );
          // [RT-Assumption-6] Dual-emit legacy + new key names during dashboard migration.
          this.tts.emitEvent(message.conversationId, 'tts.first_chunk', {
            message_id: message.id,
            provider,
            load_auth_ms: loadAuthMs,
            soniox_first_audio_ms: ttsFirstAudioMs,
            tts_first_audio_ms: ttsFirstAudioMs,
            total_first_chunk_ms: totalFirstChunkMs,
            char_count: message.content.length,
          });
        }
        // Persist the *raw provider bytes* (MP3 or PCM) — the RIFF header
        // for WAV is added at upload time so the cached object is a single
        // valid WAV file. Mixing the streaming-mode 0xFFFFFFFF header into
        // the cache would break players that strict-parse the size field.
        session.chunks.push(chunk);
        if (!session.closed && client.readyState === WebSocket.OPEN) {
          if (session.outputFormat === 'wav' && !session.headerSent) {
            session.headerSent = true;
            client.send(buildStreamingWavHeader(PCM_FORMAT), { binary: true });
          }
          client.send(chunk, { binary: true });
        }
      });
      handle.onEnd((completed) => {
        session.providerCompleted = completed;
        if (!completed) {
          this.logger.warn(
            `TTS upstream ended without completion signal messageId=${messageId} chunks=${session.chunks.length} — discarding to avoid cache poison`,
          );
        }
        void this.finalizeStream(client, session, message, principal);
      });
      handle.onError((err) => {
        const provider = this.resolveProvider(handle);
        this.logger.error(`TTS WS error provider=${provider}: ${err.message}`);
        this.tts.emitEvent(message.conversationId, 'tts.error', {
          message_id: message.id,
          provider,
          transport: 'ws',
          error: err.message.slice(0, 200),
        });
        if (!session.closed) {
          this.closeWithError(client, 4500, 'provider', err.message);
          this.cleanup(client);
        }
      });

      handle.start(message.content);
      // [RT-C] Race not yet settled at stream_open time → provider is 'pending'.
      this.tts.emitEvent(message.conversationId, 'tts.stream_open', {
        message_id: message.id,
        provider: 'pending',
        char_count: message.content.length,
        language,
      });
      this.logger.log(
        `TTS WS session started messageId=${messageId} principalKind=${principal.kind} lang=${language} chars=${message.content.length}`,
      );
    } catch (err) {
      this.logger.error(`Failed to open TTS stream: ${String(err)}`);
      this.closeWithError(client, 4500, 'provider', String(err));
      this.cleanup(client);
    }
  }

  handleDisconnect(client: WebSocket): void {
    const session = clientSessions.get(client);
    if (!session) return;
    // Mark socket gone so onAudio stops forwarding, but DO NOT touch the
    // upstream Soniox handle. We want it to keep streaming so we capture
    // and persist the full audio for this message. Persistence will happen
    // when Soniox's `onEnd(completed=true)` fires; the max-duration timer
    // remains as a hard upper bound and is the only path that aborts upstream.
    session.closed = true;
    clientSessions.delete(client);
    if (session.providerCompleted && !session.persisted && session.message && session.principal) {
      // Provider finished before the disconnect drained through here.
      void this.persistIfBuffered(session, session.message, session.principal);
    } else {
      this.logger.log(
        `TTS WS client disconnected; keeping upstream open to capture full audio messageId=${session.message?.id} bufferedChunks=${session.chunks.length}`,
      );
    }
  }

  private async streamFromStorage(
    client: WebSocket,
    session: ActiveSession,
    path: string,
    tConnect: number,
  ): Promise<void> {
    try {
      const tStorageStart = Date.now();
      const obj = await this.storage.getObject(path);
      const storageGetMs = Date.now() - tStorageStart;
      session.firstChunkAt = Date.now();
      const totalFirstChunkMs = session.firstChunkAt - tConnect;
      this.logger.log(
        `[tts-timing] cache_first_chunk path=${path} storageGetMs=${storageGetMs} totalFirstChunkMs=${totalFirstChunkMs}`,
      );
      const coalescer = createChunkCoalescer({
        maxBytes: TtsGateway.CACHE_COALESCE_MAX_BYTES,
        maxMs: TtsGateway.CACHE_COALESCE_MAX_MS,
        shouldAccept: () => !session.closed && client.readyState === WebSocket.OPEN,
        onFlush: (out) => client.send(out, { binary: true }),
      });
      obj.body.on('data', (chunk: Buffer) => coalescer.onData(chunk));
      obj.body.on('end', () => {
        coalescer.onEnd();
        this.sendEndAndClose(client, session);
      });
      obj.body.on('error', (err) => {
        coalescer.onError();
        this.logger.error(`Cache-hit stream error: ${err.message}`);
        this.closeWithError(client, 4500, 'provider', err.message);
        this.cleanup(client);
      });
    } catch (err) {
      this.logger.error(`Cache-hit fetch failed: ${String(err)}`);
      this.closeWithError(client, 4500, 'provider', String(err));
      this.cleanup(client);
    }
  }

  private async finalizeStream(
    client: WebSocket,
    session: ActiveSession,
    message: { id: string; conversationId: string; content: string },
    principal: TtsPrincipal,
  ): Promise<void> {
    // Persist regardless of client-side close state — we may have buffered
    // chunks from Soniox that must be linked to this message before exit.
    await this.persistIfBuffered(session, message, principal);
    if (!session.closed) this.sendEndAndClose(client, session);
  }

  /**
   * Idempotent: uploads buffered audio and updates ai_conversation_messages.
   * Hard guard: only persists when the provider signalled real completion
   * (`session.providerCompleted`). A partial buffer is never written to the
   * cache — that's what causes "only first chunk plays" on replay.
   */
  private async persistIfBuffered(
    session: ActiveSession,
    message: { id: string; conversationId: string; content: string },
    principal: TtsPrincipal,
  ): Promise<void> {
    if (session.persisted) return;
    session.persisted = true;
    const totalBytes = session.chunks.reduce((s, c) => s + c.length, 0);
    const firstChunkMs = session.firstChunkAt ? session.firstChunkAt - session.startedAt : null;
    const winningProvider = this.resolveProvider(session.handle);
    if (!session.providerCompleted) {
      this.logger.warn(
        `TTS WS stream did not complete; refusing to persist messageId=${message.id} provider=${winningProvider} bufferedChunks=${session.chunks.length} bufferedBytes=${totalBytes}`,
      );
      this.tts.emitEvent(message.conversationId, 'tts.incomplete_stream', {
        message_id: message.id,
        provider: winningProvider,
        transport: 'ws',
        char_count: message.content.length,
        buffered_bytes: totalBytes,
      });
      return;
    }
    if (session.chunks.length === 0) {
      this.logger.warn(
        `TTS WS stream ended with 0 audio chunks messageId=${message.id} chars=${message.content.length}`,
      );
      this.tts.emitEvent(message.conversationId, 'tts.empty_stream', {
        message_id: message.id,
        provider: winningProvider,
        transport: 'ws',
        char_count: message.content.length,
      });
      return;
    }
    let audio = Buffer.concat(session.chunks);
    const persistFormat: OutputFormat = session.outputFormat;
    if (persistFormat === 'wav') {
      // PCM buffer is just raw samples — wrap with a finalized RIFF header
      // (real data size, not 0xFFFFFFFF) so the cached object plays via any
      // standard WAV decoder, including a later cache-hit playback.
      const header = buildFinalizedWavHeader(PCM_FORMAT, audio.byteLength);
      audio = Buffer.concat([header, audio]);
    }
    // Await so we surface upload/DB errors via the service's logger before
    // the WS session is torn down.
    await this.tts.persistStreamedAudio(message as never, principal, audio, persistFormat);
    this.tts.emitEvent(message.conversationId, 'tts.synthesize', {
      message_id: message.id,
      provider: winningProvider,
      transport: 'ws',
      char_count: message.content.length,
      audio_bytes: totalBytes,
      first_chunk_ms: firstChunkMs ?? -1,
    });
  }

  private sendEndAndClose(client: WebSocket, session: ActiveSession): void {
    if (session.closed) return;
    session.closed = true;
    if (session.timer) clearTimeout(session.timer);
    const firstChunkMs = session.firstChunkAt ? session.firstChunkAt - session.startedAt : null;
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'session_end',
          first_chunk_ms: firstChunkMs,
          total_bytes: session.chunks.reduce((s, c) => s + c.length, 0),
        }),
      );
      client.close(1000);
    }
    clientSessions.delete(client);
  }

  private buildPrincipal(
    auth: { principalId: string; context: 'onboarding' | 'scenario' },
    url: URL,
  ): TtsPrincipal | null {
    if (auth.context === 'scenario') {
      return { kind: 'scenario', userId: auth.principalId };
    }
    const sessionId = auth.principalId.replace(/^onboarding:/, '');
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId || !UUID_V4.test(conversationId)) return null;
    return { kind: 'onboarding', sessionId, conversationId };
  }

  private handleAuthError(client: WebSocket, err: unknown): void {
    const name = (err as { name?: string })?.name;
    const message = (err as { message?: string })?.message || 'error';
    if (name === 'NotFoundException') {
      this.closeWithError(client, 4404, 'not_found', message);
    } else if (name === 'ForbiddenException') {
      this.closeWithError(client, 4403, 'forbidden', message);
    } else if (name === 'BadRequestException') {
      this.closeWithError(client, 4413, 'too_long', message);
    } else {
      this.closeWithError(client, 4500, 'provider', message);
    }
  }

  private closeWithError(client: WebSocket, code: number, errCode: string, message: string): void {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      try {
        client.send(JSON.stringify({ type: 'error', code: errCode, message }));
      } catch {
        // ignore
      }
      client.close(code, message.slice(0, 100));
    }
  }

  private cleanup(client: WebSocket): void {
    const session = clientSessions.get(client);
    if (!session) return;
    session.closed = true;
    if (session.timer) clearTimeout(session.timer);
    try {
      session.handle?.forceClose();
    } catch {
      // already closed
    }
    clientSessions.delete(client);
  }
}
