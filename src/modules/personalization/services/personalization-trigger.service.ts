import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { PersonalizationQuotaService } from './personalization-quota.service';
import { PersonalizationOfferedEvent } from '../events/personalization-offered.event';

@Injectable()
export class PersonalizationTriggerService {
  private readonly logger = new Logger(PersonalizationTriggerService.name);

  constructor(
    private readonly quota: PersonalizationQuotaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Fire-and-forget personalization offer when user completes a trigger scenario.
   * All errors are logged and swallowed — must NOT fail parent scenario completion.
   */
  async maybeTrigger(userId: string, scenarioId: string): Promise<void> {
    try {
      await this.tryTrigger(userId, scenarioId);
    } catch (err) {
      this.logger.warn(
        `Personalization trigger failed userId=${userId} scenarioId=${scenarioId}: ${(err as Error).message}`,
      );
    }
  }

  private async tryTrigger(userId: string, scenarioId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Advisory lock prevents double-fire on concurrent completion events
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`personalize:${userId}`]);

      const scenario = await manager.findOne(Scenario, { where: { id: scenarioId } });
      if (!scenario?.triggersPersonalization) return;

      const quotaDecision = await this.quota.checkQuota(userId);
      // Free users: drop silently. Paywall (monthly trial used): still offer chat (paywall mid-flow).
      // Daily ceiling: skip (too many generations today).
      if (quotaDecision.reason === 'free_blocked' || quotaDecision.reason === 'daily_ceiling') {
        return;
      }

      this.eventEmitter.emit(
        'personalization.offered',
        new PersonalizationOfferedEvent(userId, scenarioId),
      );

      this.logger.log(`Personalization offered: userId=${userId} scenarioId=${scenarioId}`);
    });
  }
}
