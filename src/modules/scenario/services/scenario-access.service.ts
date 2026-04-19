import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';

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
  async findAccessibleScenario(userId: string, scenarioId: string, languageId?: string): Promise<Scenario> {
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

    if (scenario.accessTier === AccessTier.PREMIUM) {
      await this.assertPremiumAccess(userId, scenarioId);
    }

    return scenario;
  }

  /**
   * Checks subscription or explicit access grant for a premium scenario.
   */
  private async assertPremiumAccess(userId: string, scenarioId: string): Promise<void> {
    const [subscription, explicitAccess] = await Promise.all([
      this.subscriptionService.getUserSubscription(userId),
      this.accessRepo.findOne({ where: { userId, scenarioId } }),
    ]);

    const hasPremium = subscription?.isActive === true;
    const hasGrant = explicitAccess !== null;

    if (!hasPremium && !hasGrant) {
      throw new ForbiddenException('Premium subscription required to access this scenario');
    }
  }
}
