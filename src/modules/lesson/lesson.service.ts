import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Scenario } from '../../database/entities/scenario.entity';
import { UserScenarioAccess } from '../../database/entities/user-scenario-access.entity';
import {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import {
  GetLessonsResponseDto,
  CategoryWithScenariosDto,
  ScenarioStatus,
} from './dto/lesson-response.dto';

@Injectable()
export class LessonService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  async getLessons(userId: string, query: GetLessonsQueryDto): Promise<GetLessonsResponseDto> {
    const { language, level, search, page = 1, limit = 20 } = query;

    // Build visibility query
    const qb = this.buildVisibilityQuery(userId, language);

    // Apply filters
    if (level) {
      qb.andWhere('scenario.difficulty = :level', { level });
    }
    if (search) {
      qb.andWhere('scenario.title ILIKE :search', { search: `%${search}%` });
    }

    // Get total count before pagination
    const total = await qb.getCount();

    // Apply pagination and ordering — category already joined in visibility query
    const scenarios = await qb
      .addSelect(['cat.id', 'cat.name', 'cat.icon', 'cat.orderIndex'])
      .addOrderBy('cat.orderIndex', 'ASC')
      .addOrderBy('scenario.orderIndex', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get subscription for status computation — expired/cancelled = free tier
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    const hasActivePremium =
      subscription &&
      subscription.plan !== SubscriptionPlan.FREE &&
      subscription.status === SubscriptionStatus.ACTIVE;
    const isFreeUser = !hasActivePremium;

    // Group by category and compute status
    const categories = this.groupByCategory(scenarios, isFreeUser);

    return {
      categories,
      pagination: { page, limit, total },
    };
  }

  /** Build query with visibility rules: global + language-specific + user-granted */
  private buildVisibilityQuery(
    userId: string,
    languageId?: string,
  ): SelectQueryBuilder<Scenario> {
    const qb = this.scenarioRepo
      .createQueryBuilder('scenario')
      .innerJoin('scenario.category', 'cat', 'cat.is_active = true')
      .where('scenario.is_active = true');

    // Subquery: scenarios user has been granted access to
    const accessSubQuery = qb
      .subQuery()
      .select('access.scenario_id')
      .from(UserScenarioAccess, 'access')
      .where('access.user_id = :userId')
      .getQuery();

    // Visibility: global OR language-match OR user-granted access
    if (languageId) {
      qb.andWhere(
        `(scenario.language_id IS NULL OR scenario.language_id = :languageId OR scenario.id IN ${accessSubQuery})`,
        { languageId, userId },
      );
    } else {
      qb.andWhere(
        `(scenario.language_id IS NULL OR scenario.id IN ${accessSubQuery})`,
        { userId },
      );
    }

    return qb;
  }

  /** Group flat scenario list by category and compute per-scenario status */
  private groupByCategory(
    scenarios: Scenario[],
    isFreeUser: boolean,
  ): CategoryWithScenariosDto[] {
    const categoryMap = new Map<string, CategoryWithScenariosDto>();

    for (const scenario of scenarios) {
      const cat = scenario.category;
      if (!categoryMap.has(cat.id)) {
        categoryMap.set(cat.id, {
          id: cat.id,
          name: cat.name,
          icon: cat.icon ?? null,
          scenarios: [],
        });
      }

      categoryMap.get(cat.id)!.scenarios.push({
        id: scenario.id,
        title: scenario.title,
        imageUrl: scenario.imageUrl ?? null,
        difficulty: scenario.difficulty,
        status: this.computeStatus(scenario, isFreeUser),
      });
    }

    return Array.from(categoryMap.values());
  }

  /** Compute scenario status based on subscription tier */
  private computeStatus(scenario: Scenario, isFreeUser: boolean): ScenarioStatus {
    if (scenario.isPremium && isFreeUser && !scenario.isTrial) {
      return ScenarioStatus.LOCKED;
    }
    if (scenario.isTrial && isFreeUser) {
      return ScenarioStatus.TRIAL;
    }
    return ScenarioStatus.AVAILABLE;
  }
}
