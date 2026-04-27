import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAiScenario } from '@/database/entities/user-ai-scenario.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { ScenarioAccessService } from './scenario-access.service';
import { ScenarioDetailDto } from '../dto/scenario-detail.dto';
import { ScenarioType } from '@/database/entities/scenario-type.enum';

@Injectable()
export class ScenariosDetailService {
  constructor(
    private readonly access: ScenarioAccessService,
    @InjectRepository(UserAiScenario)
    private readonly userAiScenarioRepo: Repository<UserAiScenario>,
  ) {}

  async get(userId: string, scenarioId: string, languageId: string): Promise<ScenarioDetailDto> {
    try {
      const result = await this.access.checkAccess(userId, scenarioId, languageId);
      const { scenario } = result;
      const source =
        scenario.type === ScenarioType.KOL ? 'kol' : ('default' as const);
      return {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description ?? null,
        imageUrl: scenario.imageUrl,
        difficulty: scenario.difficulty,
        languageId: scenario.languageId,
        orderIndex: scenario.orderIndex,
        category: { id: scenario.category.id, name: scenario.category.name },
        accessTier: scenario.accessTier,
        isLocked: result.isLocked,
        lockReason: result.isLocked ? result.lockReason : undefined,
        userStatus: result.isLocked ? 'locked' : 'available',
        source,
      };
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      const personal = await this.userAiScenarioRepo.findOne({
        where: { id: scenarioId, userId, languageId },
      });
      if (!personal) throw err;
      return {
        id: personal.id,
        title: personal.title,
        description: personal.description ?? null,
        imageUrl: undefined,
        difficulty: personal.difficulty,
        languageId: personal.languageId,
        orderIndex: 0,
        category: undefined,
        accessTier: AccessTier.FREE,
        isLocked: false,
        lockReason: undefined,
        userStatus: 'available',
        source: 'personalized',
      };
    }
  }
}
