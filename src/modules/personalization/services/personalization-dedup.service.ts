import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/database/entities/user.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { ContentStatus } from '@/database/entities/content-status.enum';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PersonalizationDedupService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  /** Returns true when generation should be skipped: last run <24h ago AND profile unchanged. */
  shouldSkipGeneration(user: User, freshProfile: Record<string, unknown>): boolean {
    if (!user.lastPersonalizationAt) return false;

    const elapsed = Date.now() - user.lastPersonalizationAt.getTime();
    if (elapsed >= DEDUP_WINDOW_MS) return false;

    const diff = this.computeProfileDiff(user.personalizationProfileSnapshot ?? null, freshProfile);
    return !diff.hasNew;
  }

  computeProfileDiff(
    snapshot: Record<string, unknown> | null,
    fresh: Record<string, unknown>,
  ): { hasNew: boolean; addedKeys: string[] } {
    if (!snapshot) return { hasNew: true, addedKeys: Object.keys(fresh) };

    const snapshotKeys = new Set(Object.keys(snapshot));
    const freshKeys = Object.keys(fresh);

    const addedKeys = freshKeys.filter((k) => !snapshotKeys.has(k));
    if (addedKeys.length > 0) return { hasNew: true, addedKeys };

    // Check value equality for shared keys (JSON-based to handle nested objects)
    const hasChangedValue = freshKeys.some((k) => {
      if (!snapshotKeys.has(k)) return false;
      return JSON.stringify(snapshot[k]) !== JSON.stringify(fresh[k]);
    });

    return { hasNew: hasChangedValue, addedKeys: [] };
  }

  async getRecentPersonalScenarios(userId: string, limit = 5): Promise<Scenario[]> {
    return this.scenarioRepo.find({
      where: {
        ownerId: userId,
        type: ScenarioType.PERSONAL,
        status: ContentStatus.PUBLISHED,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
