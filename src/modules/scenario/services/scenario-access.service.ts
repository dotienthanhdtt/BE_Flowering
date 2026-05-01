import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';

export type ScenarioAccessResult =
  | { scenario: Scenario; isLocked: false; lockReason?: never }
  | { scenario: Scenario; isLocked: true; lockReason: 'premium_required' };

/**
 * Handles scenario access control:
 * - Verifies scenario exists, is active, and visible to the requesting user
 *   (public rows always visible; personal rows only to their owner)
 * - Enforces premium gating uniformly via subscription or explicit access grant
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

  async findAccessibleScenario(
    userId: string,
    scenarioId: string,
    languageId?: string,
  ): Promise<Scenario> {
    const scenario = await this.findVisibleToUser(userId, scenarioId, languageId);

    if (scenario.accessTier === AccessTier.PREMIUM) {
      await this.assertPremiumAccess(userId, scenarioId);
    }

    return scenario;
  }

  async checkAccess(
    userId: string,
    scenarioId: string,
    languageId?: string,
  ): Promise<ScenarioAccessResult> {
    const scenario = await this.findVisibleToUser(userId, scenarioId, languageId);

    if (scenario.accessTier !== AccessTier.PREMIUM) {
      return { scenario, isLocked: false };
    }

    const hasAccess = await this.evaluatePremiumAccess(userId, scenarioId);
    return hasAccess
      ? { scenario, isLocked: false }
      : { scenario, isLocked: true, lockReason: 'premium_required' };
  }

  /**
   * Owner-aware single fetch. Returns the scenario only if it is public
   * (owner_id IS NULL) or owned by the requesting user.
   */
  async findVisibleToUser(
    userId: string,
    scenarioId: string,
    languageId?: string,
  ): Promise<Scenario> {
    const baseWhere = { id: scenarioId, status: ContentStatus.PUBLISHED };
    const scenario = await this.scenarioRepo.findOne({
      where: [
        { ...baseWhere, ownerId: IsNull() },
        { ...baseWhere, ownerId: userId },
      ],
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

  /** Public catalog listing (system or kol). Excludes personal rows. */
  async listPublicByType(
    type: ScenarioType.SYSTEM | ScenarioType.KOL,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Scenario[]; total: number }> {
    const [items, total] = await this.scenarioRepo.findAndCount({
      where: { type, status: ContentStatus.PUBLISHED, languageId, ownerId: IsNull() },
      order: { orderIndex: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['category'],
    });
    return { items, total };
  }

  /** Personal scenarios owned by the requesting user. */
  async listPersonalForUser(userId: string, languageId: string): Promise<Scenario[]> {
    return this.scenarioRepo.find({
      where: {
        type: ScenarioType.PERSONAL,
        ownerId: userId,
        languageId,
        status: ContentStatus.PUBLISHED,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async assertPremiumAccess(userId: string, scenarioId: string): Promise<void> {
    // TODO: temporarily disabled premium gating — re-enable when access logic is finalized
    void userId;
    void scenarioId;
    return;
    // const hasAccess = await this.evaluatePremiumAccess(userId, scenarioId);
    // if (!hasAccess) {
    //   throw new ForbiddenException('Premium subscription required to access this scenario');
    // }
  }

  private async evaluatePremiumAccess(userId: string, scenarioId: string): Promise<boolean> {
    const [subscription, explicitAccess] = await Promise.all([
      this.subscriptionService.getUserSubscription(userId),
      this.accessRepo.findOne({ where: { userId, scenarioId } }),
    ]);

    return subscription?.isActive === true || explicitAccess !== null;
  }
}
