import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '@/database/entities/user.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { SubscriptionPlan } from '@/database/entities/subscription.entity';
import { QuotaDecision } from '../types/quota-decision.type';

/** Max personal scenario generations per 24-hour window (all paid tiers). */
const DAILY_CEILING = 3;

@Injectable()
export class PersonalizationQuotaService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async checkQuota(userId: string): Promise<QuotaDecision> {
    const subscription = await this.subscriptionService.getUserSubscription(userId);

    // No active subscription → free tier → blocked
    if (!subscription?.isActive) {
      return { allowed: false, reason: 'free_blocked' };
    }

    // Daily ceiling applies to all paid tiers
    const dailyCount = await this.countPersonalScenariosLast24h(userId);
    if (dailyCount >= DAILY_CEILING) {
      return { allowed: false, reason: 'daily_ceiling' };
    }

    // Lifetime plan = unlimited (PREMIUM_PLUS equivalent)
    if (subscription.plan === SubscriptionPlan.LIFETIME) {
      return { allowed: true, reason: 'ok' };
    }

    // Monthly/Yearly → 1 trial per UTC calendar month
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'personalizedTrialUsedAt'],
    });

    if (user?.personalizedTrialUsedAt && this.isCurrentUtcMonth(user.personalizedTrialUsedAt)) {
      return { allowed: false, reason: 'paywall' };
    }

    return { allowed: true, reason: 'ok', quotaRemaining: 1 };
  }

  async markPremiumTrialUsed(userId: string): Promise<void> {
    await this.userRepo.update(userId, { personalizedTrialUsedAt: new Date() });
  }

  private async countPersonalScenariosLast24h(userId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.scenarioRepo.count({
      where: {
        ownerId: userId,
        type: ScenarioType.PERSONAL,
        createdAt: MoreThan(since),
      },
    });
  }

  /** Returns true if the given date falls in the current UTC calendar month. */
  private isCurrentUtcMonth(date: Date): boolean {
    const now = new Date();
    return (
      date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth()
    );
  }
}
