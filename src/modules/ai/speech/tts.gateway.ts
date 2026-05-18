import { Logger } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { WsAuthGuard } from './ws-auth.guard';
import { TtsService, TtsPrincipal } from './tts.service';
import { SonioxTtsProvider } from '../providers/soniox-tts.provider';
import { ObjectStorageService } from '../../../database/object-storage.service';
import { TtsStreamHandle } from '../providers/tts-provider.interface';
import { createChunkCoalescer } from './chunk-coalescer';

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
    private readonly soniox: SonioxTtsProvider,
    private readonly storage: ObjectStorageService,
  ) {}

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

    // Cache hit → fetch stored mp3, stream once, end
    if (message.audioUrl) {
      this.tts.emitEvent(message.conversationId, 'tts.cache_hit', {
        message_id: message.id,
        provider: this.soniox.name,
        transport: 'ws',
        language,
        load_auth_ms: loadAuthMs,
      });
      this.logger.log(
        `[tts-timing] cache_hit messageId=${messageId} loadAuthMs=${loadAuthMs}`,
      );
      await this.streamFromStorage(client, session, message.audioUrl, tConnect);
      return;
    }

    // Cache miss → open Soniox stream
    const tSonioxOpen = Date.now();
    try {
      const handle = this.soniox.openStream({
        traceId: message.conversationId,
        language,
      });
      session.handle = handle;

      handle.onOpen?.(() => {
        const sonioxConnectMs = Date.now() - tSonioxOpen;
        this.logger.log(
          `[tts-timing] soniox_ws_open messageId=${messageId} sonioxConnectMs=${sonioxConnectMs}`,
        );
        this.tts.emitEvent(message.conversationId, 'tts.stream_ws_open', {
          message_id: message.id,
          soniox_connect_ms: sonioxConnectMs,
        });
      });

      handle.onAudio((chunk) => {
        if (session.closed) return;
        if (!session.firstChunkAt) {
          session.firstChunkAt = Date.now();
          const totalFirstChunkMs = session.firstChunkAt - tConnect;
          const sonioxFirstAudioMs = session.firstChunkAt - tSonioxOpen;
          this.logger.log(
            `[tts-timing] first_chunk messageId=${messageId} loadAuthMs=${loadAuthMs} sonioxFirstAudioMs=${sonioxFirstAudioMs} totalFirstChunkMs=${totalFirstChunkMs} chars=${message.content.length}`,
          );
          this.tts.emitEvent(message.conversationId, 'tts.first_chunk', {
            message_id: message.id,
            load_auth_ms: loadAuthMs,
            soniox_first_audio_ms: sonioxFirstAudioMs,
            total_first_chunk_ms: totalFirstChunkMs,
            char_count: message.content.length,
          });
        }
        session.chunks.push(chunk);
        if (client.readyState === WebSocket.OPEN) {
          client.send(chunk, { binary: true });
        }
      });
      handle.onEnd(() => {
        void this.finalizeStream(client, session, message, principal);
      });
      handle.onError((err) => {
        this.logger.error(`Soniox TTS WS error: ${err.message}`);
        this.tts.emitEvent(message.conversationId, 'tts.error', {
          message_id: message.id,
          provider: this.soniox.name,
          transport: 'ws',
          error: err.message.slice(0, 200),
        });
        if (!session.closed) {
          this.closeWithError(client, 4500, 'provider', err.message);
          this.cleanup(client);
        }
      });

      handle.start(message.content);
      this.tts.emitEvent(message.conversationId, 'tts.stream_open', {
        message_id: message.id,
        provider: this.soniox.name,
        char_count: message.content.length,
        language,
      });
      this.logger.log(
        `TTS WS session started messageId=${messageId} principalKind=${principal.kind} lang=${language} chars=${message.content.length}`,
      );
    } catch (err) {
      this.logger.error(`Failed to open Soniox TTS stream: ${String(err)}`);
      this.closeWithError(client, 4500, 'provider', String(err));
      this.cleanup(client);
    }
  }

  handleDisconnect(client: WebSocket): void {
    const session = clientSessions.get(client);
    if (!session) return;
    session.closed = true;
    if (session.timer) clearTimeout(session.timer);
    // Flush buffered audio to storage + DB before tearing down. Fire-and-forget
    // because the WS is already gone; persistIfBuffered is idempotent so a
    // concurrent finalizeStream is safe.
    if (
      !session.persisted &&
      session.chunks.length > 0 &&
      session.message &&
      session.principal
    ) {
      void this.persistIfBuffered(session, session.message, session.principal);
    }
    try {
      session.handle?.forceClose();
    } catch {
      // already closed
    }
    clientSessions.delete(client);
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
        shouldAccept: () =>
          !session.closed && client.readyState === WebSocket.OPEN,
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
   * Also emits the corresponding Langfuse event (synthesize | empty_stream).
   */
  private async persistIfBuffered(
    session: ActiveSession,
    message: { id: string; conversationId: string; content: string },
    principal: TtsPrincipal,
  ): Promise<void> {
    if (session.persisted) return;
    session.persisted = true;
    const totalBytes = session.chunks.reduce((s, c) => s + c.length, 0);
    const firstChunkMs = session.firstChunkAt
      ? session.firstChunkAt - session.startedAt
      : null;
    if (session.chunks.length === 0) {
      this.logger.warn(
        `TTS WS stream ended with 0 audio chunks messageId=${message.id} chars=${message.content.length}`,
      );
      this.tts.emitEvent(message.conversationId, 'tts.empty_stream', {
        message_id: message.id,
        provider: this.soniox.name,
        transport: 'ws',
        char_count: message.content.length,
      });
      return;
    }
    const audio = Buffer.concat(session.chunks);
    // Await so we surface upload/DB errors via the service's logger before
    // the WS session is torn down.
    await this.tts.persistStreamedAudio(message as never, principal, audio);
    this.tts.emitEvent(message.conversationId, 'tts.synthesize', {
      message_id: message.id,
      provider: this.soniox.name,
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

  private closeWithError(
    client: WebSocket,
    code: number,
    errCode: string,
    message: string,
  ): void {
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
