import { Logger } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { WsAuthGuard } from './ws-auth.guard';
import { SpeechService } from './speech.service';
import { SpeechSession, ServerMsg } from './speech.types';

const MAX_DURATION_MS = 180_000; // 3 min

/** Map from ws client to its active SpeechSession (used in disconnect). */
const clientSessions = new WeakMap<WebSocket, SpeechSession>();

@WebSocketGateway({ path: '/ws/speech/stt' })
export class SpeechGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SpeechGateway.name);

  constructor(
    private readonly auth: WsAuthGuard,
    private readonly speech: SpeechService,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    const authResult = this.auth.validate(req);
    if (!authResult) {
      this.sendMsg(client, { type: 'error', code: 'auth', message: 'Unauthorized' });
      client.close(4401, 'Unauthorized');
      return;
    }

    const { principalId, context } = authResult;

    if (this.speech.hasSession(principalId)) {
      this.sendMsg(client, {
        type: 'error',
        code: 'concurrent',
        message: 'Session already active',
      });
      client.close(4429, 'Session already active');
      return;
    }

    const url = new URL(req.url || '', 'ws://localhost');
    const rawTraceId = url.searchParams.get('traceId');
    const traceId =
      rawTraceId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawTraceId)
        ? rawTraceId
        : crypto.randomUUID();
    const lang = url.searchParams.get('lang') || undefined;

    const session = this.speech.startSession(
      principalId,
      traceId,
      lang,
      context,
      (text) => this.sendMsg(client, { type: 'partial', text }),
      (text) => this.sendMsg(client, { type: 'final', text }),
      (err) => {
        this.logger.error(`Provider error for ${principalId}: ${err.message}`);
        this.sendMsg(client, { type: 'error', code: 'provider', message: err.message });
        client.close(4500, 'Provider error');
      },
      () => {
        if (clientSessions.has(client)) {
          clientSessions.delete(client);
          if (session.timer) clearTimeout(session.timer);
          this.speech.abortSession(session);
          client.close(4503, 'Provider connection closed');
        }
      },
    );

    clientSessions.set(client, session);

    // 3-min hard cap
    const timer = setTimeout(() => {
      this.sendMsg(client, {
        type: 'error',
        code: 'max_duration',
        message: 'Max duration reached',
      });
      client.close(4408, 'Max duration reached');
    }, MAX_DURATION_MS);
    // Prevent timer from blocking process exit
    if (timer.unref) timer.unref();
    session.timer = timer;

    // Handle incoming messages
    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      void this.handleMessage(client, session, data, isBinary);
    });

    this.logger.log(`STT session started: principal=${principalId} traceId=${traceId}`);
  }

  handleDisconnect(client: WebSocket): void {
    const session = clientSessions.get(client);
    if (!session) return;
    clientSessions.delete(client);
    if (session.timer) clearTimeout(session.timer);
    this.speech.abortSession(session);
    this.logger.log(`STT session aborted (disconnect): principal=${session.principalId}`);
  }

  private async handleMessage(
    client: WebSocket,
    session: SpeechSession,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary || Buffer.isBuffer(data)) {
      try {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        this.speech.pushAudio(session, chunk);
      } catch (err) {
        const isOverflow = err instanceof Error && err.message.includes('overflow');
        if (isOverflow) {
          this.sendMsg(client, { type: 'error', code: 'overflow', message: 'Audio buffer overflow' });
          client.close(4413, 'Audio buffer overflow');
        } else {
          this.sendMsg(client, { type: 'error', code: 'provider', message: 'Provider write error' });
          client.close(4500, 'Provider write error');
        }
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString()) as { type?: string };
      if (msg.type === 'end') {
        if (session.ending) return;
        session.ending = true;
        await this.finalizeSession(client, session);
      }
    } catch {
      // malformed text frame — ignore
    }
  }

  private async finalizeSession(client: WebSocket, session: SpeechSession): Promise<void> {
    clientSessions.delete(client);
    if (session.timer) clearTimeout(session.timer);

    try {
      const { transcript, audioUrl } = await this.speech.endSession(session);
      this.sendMsg(client, {
        type: 'session_end',
        transcript,
        audioUrl,
        traceId: session.traceId,
      });
    } catch (err) {
      this.logger.error(`endSession error: ${String(err)}`);
      this.sendMsg(client, {
        type: 'error',
        code: 'provider',
        message: 'Failed to finalize session',
      });
    } finally {
      client.close(1000);
    }
  }

  private sendMsg(client: WebSocket, msg: ServerMsg): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
