import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';

export type ScenarioAccessResult =
  | { scenario: Scenario; isLocked: false; lockReason?: never }
  | { scenario: Scenario; isLocked: true; lockReason: 'premium_required' };

/**
 * Handles scenario access control:
 * - Verifies scenario exists and is active
 * - Enforces premium gating via subscription or explicit access grant
 */
@Injectable()
export class ScenarioAccessService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(UserScenarioAccess)
    private readonly accessRepo: Repository<UserScenarioAccess>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Finds a scenario and verifies the user is allowed to access it.
   * If languageId is provided, also verifies scenario belongs to that language.
   * Throws NotFoundException or ForbiddenException on failure.
   */
  async findAccessibleScenario(
    userId: string,
    scenarioId: string,
    languageId?: string,
  ): Promise<Scenario> {
    const scenario = await this.fetchPublishedScenario(scenarioId, languageId);

    if (scenario.accessTier === AccessTier.PREMIUM) {
      await this.assertPremiumAccess(userId, scenarioId);
    }

    return scenario;
  }

  /**
   * Returns scenario with soft-lock state instead of throwing for premium blocks.
   * Throws NotFoundException only for hard errors (missing, unpublished, language mismatch).
   */
  async checkAccess(
    userId: string,
    scenarioId: string,
    languageId?: string,
  ): Promise<ScenarioAccessResult> {
    const scenario = await this.fetchPublishedScenario(scenarioId, languageId);

    if (scenario.accessTier !== AccessTier.PREMIUM) {
      return { scenario, isLocked: false };
    }

    const hasAccess = await this.evaluatePremiumAccess(userId, scenarioId);
    return hasAccess
      ? { scenario, isLocked: false }
      : { scenario, isLocked: true, lockReason: 'premium_required' };
  }

  private async fetchPublishedScenario(scenarioId: string, languageId?: string): Promise<Scenario> {
    const scenario = await this.scenarioRepo.findOne({
      where: { id: scenarioId, status: ContentStatus.PUBLISHED },
      relations: ['category'],
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    if (languageId && scenario.languageId !== languageId) {
      throw new NotFoundException('Scenario not available for active language');
    }

    return scenario;
  }

  private async assertPremiumAccess(userId: string, scenarioId: string): Promise<void> {
    const hasAccess = await this.evaluatePremiumAccess(userId, scenarioId);
    if (!hasAccess) {
      throw new ForbiddenException('Premium subscription required to access this scenario');
    }
  }

  private async evaluatePremiumAccess(userId: string, scenarioId: string): Promise<boolean> {
    const [subscription, explicitAccess] = await Promise.all([
      this.subscriptionService.getUserSubscription(userId),
      this.accessRepo.findOne({ where: { userId, scenarioId } }),
    ]);

    return subscription?.isActive === true || explicitAccess !== null;
  }
}
