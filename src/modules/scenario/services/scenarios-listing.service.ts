import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserAiScenario } from '@/database/entities/user-ai-scenario.entity';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { ScenarioDefaultDto } from '../dto/scenario-default.dto';
import { ScenarioPersonalDto } from '../dto/scenario-personal.dto';

@Injectable()
export class ScenariosListingService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(UserAiScenario)
    private readonly userAiScenarioRepo: Repository<UserAiScenario>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
  ) {}

  async listDefault(
    userId: string,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ScenarioDefaultDto[]; total: number }> {
    await this.markLastLearned(userId, languageId);

    const [rows, total] = await this.scenarioRepo.findAndCount({
      where: { type: ScenarioType.DEFAULT, status: ContentStatus.PUBLISHED, languageId },
      order: { orderIndex: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const items: ScenarioDefaultDto[] = rows.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      imageUrl: s.imageUrl,
      difficulty: s.difficulty,
      languageId: s.languageId,
      orderIndex: s.orderIndex,
    }));
    return { items, total };
  }

  async listPersonal(
    userId: string,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ScenarioPersonalDto[]; total: number }> {
    const [aiScenarios, kolAccess] = await Promise.all([
      this.userAiScenarioRepo.find({ where: { userId, languageId } }),
      this.scenarioRepo
        .createQueryBuilder('s')
        .innerJoin(UserScenarioAccess, 'usa', 'usa.scenario_id = s.id')
        .where('usa.user_id = :userId', { userId })
        .andWhere('s.language_id = :languageId', { languageId })
        .andWhere('s.status = :status', { status: ContentStatus.PUBLISHED })
        .andWhere('s.type = :type', { type: ScenarioType.KOL })
        .addSelect('usa.granted_at', 'grantedAt')
        .getRawAndEntities(),
    ]);

    const personalized: ScenarioPersonalDto[] = aiScenarios.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      difficulty: a.difficulty,
      languageId: a.languageId,
      addedAt: a.createdAt,
      source: 'personalized' as const,
    }));

    const grantedAtMap = new Map<string, Date>(
      kolAccess.raw.map((r) => [r.s_id as string, new Date(r.grantedAt as string)]),
    );
    const kol: ScenarioPersonalDto[] = kolAccess.entities.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      difficulty: s.difficulty,
      languageId: s.languageId,
      addedAt: grantedAtMap.get(s.id) ?? s.createdAt,
      source: 'kol' as const,
    }));

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
