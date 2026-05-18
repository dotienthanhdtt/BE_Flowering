import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import * as jwt from 'jsonwebtoken';

export interface WsAuthResult {
  principalId: string;
  context: 'onboarding' | 'scenario';
}

@Injectable()
export class WsAuthGuard {
  private readonly logger = new Logger(WsAuthGuard.name);
  private readonly jwtSecret: string;

  constructor(configService: ConfigService) {
    this.jwtSecret = configService.get<string>('jwt.secret') || '';
  }

  /**
   * Validates a WebSocket upgrade request.
   * Returns WsAuthResult on success, or null on failure.
   */
  validate(req: IncomingMessage): WsAuthResult | null {
    try {
      const url = new URL(req.url || '', 'ws://localhost');
      const context = url.searchParams.get('context') as 'onboarding' | 'scenario' | null;

      if (context === 'scenario') {
        return this.validateScenario(req, url);
      }
      if (context === 'onboarding') {
        return this.validateOnboarding(url);
      }
      return null;
    } catch (err) {
      this.logger.warn(`WS auth error: ${String(err)}`);
      return null;
    }
  }

  private validateScenario(req: IncomingMessage, url: URL): WsAuthResult | null {
    // Accept token from Authorization header OR query param (mobile WebSocket limitation)
    const authHeader = req.headers['authorization'];
    const queryToken = url.searchParams.get('token');
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (queryToken ?? null);

    if (!rawToken) return null;

    const payload = jwt.verify(rawToken, this.jwtSecret, { algorithms: ['HS256'] }) as {
      sub?: string;
    };
    if (!payload?.sub) return null;
    return { principalId: payload.sub, context: 'scenario' };
  }

  private validateOnboarding(url: URL): WsAuthResult | null {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !this.isUuidV4(sessionId)) return null;
    return { principalId: `onboarding:${sessionId}`, context: 'onboarding' };
  }

  private isUuidV4(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
