import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { CategoryGroupDto } from '../dto/category-group.dto';
import { ScenarioListItemDto } from '../dto/scenario-list-item.dto';
import { ListScenariosGroupedResponseDto } from '../dto/list-scenarios-response.dto';

interface VisibleScenarioRow {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  language_id: string;
  access_tier: string;
  type: string;
  sort_at: Date;
  source: string;
  cat_id: string;
  cat_name: string;
  cat_slug: string;
  cat_order: number;
}

@Injectable()
export class ScenariosListingService {
  constructor(
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async listGrouped(
    userId: string,
    languageId: string,
    page: number,
    limit: number,
  ): Promise<ListScenariosGroupedResponseDto> {
    await this.markLastLearned(userId, languageId);

    const [rows, userIsPremium] = await Promise.all([
      this.queryVisibleScenarios(userId, languageId),
      this.subscriptionService.isUserPremium(userId),
    ]);

    // Group by category
    const categoryMap = new Map<
      string,
      { meta: CategoryGroupDto['category']; scenarios: ScenarioListItemDto[] }
    >();

    for (const row of rows) {
      if (!categoryMap.has(row.cat_id)) {
        categoryMap.set(row.cat_id, {
          meta: {
            id: row.cat_id,
            name: row.cat_name,
            slug: row.cat_slug,
            orderIndex: row.cat_order,
          },
          scenarios: [],
        });
      }

      const locked =
        row.access_tier === AccessTier.PREMIUM && !userIsPremium ? true : undefined;

      const item: ScenarioListItemDto = {
        id: row.id,
        title: row.title,
        languageId: row.language_id,
        type: row.type,
        source: row.source,
        addedAt: new Date(row.sort_at),
        description: row.description ?? undefined,
        imageUrl: row.image_url ?? undefined,
        ...(locked !== undefined ? { locked } : {}),
      };

      categoryMap.get(row.cat_id)!.scenarios.push(item);
    }

    // Sort categories by order_index ASC then id ASC (stable), filter empty
    const sortedCategories = [...categoryMap.values()]
      .filter((c) => c.scenarios.length > 0)
      .sort((a, b) => a.meta.orderIndex - b.meta.orderIndex || a.meta.id.localeCompare(b.meta.id));

    // Within each category sort by addedAt DESC (already in sort_at order from query, but enforce)
    for (const cat of sortedCategories) {
      cat.scenarios.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    }

    const total = sortedCategories.length;
    const offset = (page - 1) * limit;
    const pageItems: CategoryGroupDto[] = sortedCategories
      .slice(offset, offset + limit)
      .map((c) => ({ category: c.meta, scenarios: c.scenarios }));

    return {
      items: pageItems,
      pagination: { page, limit, total },
    };
  }

  private async queryVisibleScenarios(
    userId: string,
    languageId: string,
  ): Promise<VisibleScenarioRow[]> {
    return this.userLanguageRepo.manager.query(
      `
      WITH visible AS (
        SELECT
          s.id,
          s.title,
          s.description,
          s.image_url,
          s.language_id,
          s.category_id,
          s.access_tier,
          s.type,
          s.created_at,
          usa.granted_at,
          COALESCE(usa.granted_at, s.created_at) AS sort_at,
          CASE
            WHEN s.type = 'kol'      THEN 'kol'
            WHEN s.type = 'personal' THEN 'personalized'
            ELSE 'system'
          END AS source
        FROM scenarios s
        LEFT JOIN user_scenario_access usa
               ON usa.scenario_id = s.id AND usa.user_id = $1
        WHERE s.language_id = $2
          AND s.status = 'published'
          AND (
                (s.type = 'system'   AND s.owner_id IS NULL)
             OR (s.type = 'personal' AND s.owner_id = $1)
             OR (s.type = 'kol'      AND usa.user_id IS NOT NULL AND s.owner_id IS NULL)
          )
      )
      SELECT
        v.id, v.title, v.description, v.image_url, v.language_id,
        v.access_tier, v.type, v.sort_at, v.source,
        c.id   AS cat_id,
        c.name AS cat_name,
        c.slug AS cat_slug,
        c.order_index AS cat_order
      FROM visible v
      JOIN scenario_categories c ON c.id = v.category_id
      ORDER BY c.order_index ASC, v.sort_at DESC
      `,
      [userId, languageId],
    );
  }

  private async markLastLearned(userId: string, languageId: string): Promise<void> {
    // Single atomic statement: true only for the target language, false for all others
    await this.userLanguageRepo.manager.query(
      `UPDATE user_languages SET last_learned = (language_id = $2) WHERE user_id = $1`,
      [userId, languageId],
    );
  }
}
