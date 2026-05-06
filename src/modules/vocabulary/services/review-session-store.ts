import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface ReviewSession {
  id: string;
  userId: string;
  cardIds: string[];
  /** vocabId → `true` for correct, `false` for wrong */
  ratings: Map<string, boolean>;
  startedAt: Date;
}

/**
 * In-memory review session store. Single-pod only — restart loses sessions
 * (acceptable for MVP; see brainstorm). TTL-swept every 5 minutes.
 */
@Injectable()
export class ReviewSessionStore implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly TTL_MS = 60 * 60 * 1000; // 1h
  private readonly SWEEP_MS = 5 * 60 * 1000; // 5m
  private sweepTimer?: NodeJS.Timeout;

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), this.SWEEP_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  create(userId: string, cardIds: string[]): ReviewSession {
    const session: ReviewSession = {
      id: randomUUID(),
      userId,
      cardIds,
      ratings: new Map(),
      startedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Fetch + ownership + expiry check, all-in-one. */
  get(sessionId: string, userId: string): ReviewSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException('Session not found or expired');
    if (s.userId !== userId) throw new ForbiddenException();
    if (Date.now() - s.startedAt.getTime() > this.TTL_MS) {
      this.sessions.delete(sessionId);
      throw new NotFoundException('Session expired');
    }
    return s;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** @internal Exposed for tests. */
  sweep(): void {
    const cutoff = Date.now() - this.TTL_MS;
    for (const [id, s] of this.sessions) {
      if (s.startedAt.getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}
