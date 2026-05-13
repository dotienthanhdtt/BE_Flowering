import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { ScenarioDefaultDto } from '../dto/scenario-default.dto';
import { ScenarioPersonalDto } from '../dto/scenario-personal.dto';
import { ScenarioAccessService } from './scenario-access.service';

@Injectable()
export class ScenariosListingService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    private readonly access: ScenarioAccessService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async listDefault(
    userId: string,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ScenarioDefaultDto[]; total: number }> {
    await this.markLastLearned(userId, languageId);

    const [{ items: rows, total }, userIsPremium] = await Promise.all([
      this.access.listPublicByType(ScenarioType.SYSTEM, languageId, page, limit),
      this.subscriptionService.isUserPremium(userId),
    ]);

    const items: ScenarioDefaultDto[] = rows.map((s) => {
      const isPremiumRow = s.accessTier === AccessTier.PREMIUM;
      const locked = isPremiumRow && !userIsPremium ? true : undefined;
      return {
        id: s.id,
        title: s.title,
        // Omit description/imageUrl/orderIndex for locked stubs
        ...(locked
          ? {}
          : {
              description: s.description,
              imageUrl: s.imageUrl,
              orderIndex: s.orderIndex,
            }),
        languageId: s.languageId,
        orderIndex: s.orderIndex,
        ...(locked !== undefined ? { locked } : {}),
      };
    });
    return { items, total };
  }

  async listPersonal(
    userId: string,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ScenarioPersonalDto[]; total: number }> {
    const [personalRows, kolAccess, userIsPremium] = await Promise.all([
      this.access.listPersonalForUser(userId, languageId),
      this.scenarioRepo
        .createQueryBuilder('s')
        .innerJoin(UserScenarioAccess, 'usa', 'usa.scenario_id = s.id')
        .where('usa.user_id = :userId', { userId })
        .andWhere('s.language_id = :languageId', { languageId })
        .andWhere('s.status = :status', { status: ContentStatus.PUBLISHED })
        .andWhere('s.type = :type', { type: ScenarioType.KOL })
        .andWhere('s.owner_id IS NULL')
        .addSelect('usa.granted_at', 'grantedAt')
        .getRawAndEntities(),
      this.subscriptionService.isUserPremium(userId),
    ]);

    const personalized: ScenarioPersonalDto[] = personalRows.map((s) => {
      const locked = s.accessTier === AccessTier.PREMIUM && !userIsPremium ? true : undefined;
      return {
        id: s.id,
        title: s.title,
        ...(locked ? {} : { description: s.description, imageUrl: s.imageUrl }),
        languageId: s.languageId,
        addedAt: s.createdAt,
        source: 'personalized' as const,
        ...(locked !== undefined ? { locked } : {}),
      };
    });

    const grantedAtMap = new Map<string, Date>(
      kolAccess.raw.map((r) => [r.s_id as string, new Date(r.grantedAt as string)]),
    );
    const kol: ScenarioPersonalDto[] = kolAccess.entities.map((s) => {
      const locked = s.accessTier === AccessTier.PREMIUM && !userIsPremium ? true : undefined;
      return {
        id: s.id,
        title: s.title,
        ...(locked ? {} : { description: s.description, imageUrl: s.imageUrl }),
        languageId: s.languageId,
        addedAt: grantedAtMap.get(s.id) ?? s.createdAt,
        source: 'kol' as const,
        ...(locked !== undefined ? { locked } : {}),
      };
    });

    const merged = [...personalized, ...kol].sort(
      (a, b) => b.addedAt.getTime() - a.addedAt.getTime(),
    );

    const total = merged.length;
    const offset = (page - 1) * limit;
    return { items: merged.slice(offset, offset + limit), total };
  }

  private async markLastLearned(userId: string, languageId: string): Promise<void> {
    await this.userLanguageRepo.manager.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserLanguage);
      await repo.update({ userId }, { lastLearned: false });
      await repo.update({ userId, languageId }, { lastLearned: true });
    });
  }
}
