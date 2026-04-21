import { Injectable } from '@nestjs/common';
import { ScenarioAccessService } from './scenario-access.service';
import { ScenarioDetailDto } from '../dto/scenario-detail.dto';

@Injectable()
export class ScenariosDetailService {
  constructor(private readonly access: ScenarioAccessService) {}

  async get(userId: string, scenarioId: string, languageId: string): Promise<ScenarioDetailDto> {
    const result = await this.access.checkAccess(userId, scenarioId, languageId);
    const { scenario } = result;
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
    };
  }
}
