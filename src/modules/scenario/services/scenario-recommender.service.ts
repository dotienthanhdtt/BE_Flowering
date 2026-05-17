import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { SubscriptionService } from '@/modules/subscription/subscription.service';
import { NextScenarioItemDto } from '../dto/scenario-complete.dto';

interface RecommendNextInput {
  userId: string;
  anchorScenarioId: string;
  anchorCategoryId: string | null;
  languageId: string;
}

@Injectable()
export class ScenarioRecommenderService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async recommendNext(input: RecommendNextInput): Promise<NextScenarioItemDto[]> {
    const { userId, anchorScenarioId, anchorCategoryId, languageId } = input;
    const isPremium = await this.subscriptionService.isUserPremium(userId);

    const sql = `
      SELECT
        s.id,
        s.title,
        s.description,
        s.image_url,
        s.access_tier,
        s.category_id,
        c.id   AS category_pk,
        c.name AS category_name,
        CASE
          WHEN s.access_tier = 'premium'
               AND $3 = false
               AND NOT EXISTS (
                 SELECT 1 FROM user_scenario_access usa
                 WHERE usa.user_id = $1 AND usa.scenario_id = s.id
               )
          THEN true ELSE false
        END AS is_locked,
        CASE
          WHEN $4::uuid IS NOT NULL AND s.category_id = $4::uuid THEN true
          ELSE false
        END AS same_category
      FROM scenarios s
      LEFT JOIN scenario_categories c ON c.id = s.category_id
      WHERE s.language_id = $5
        AND s.status      = 'published'
        AND (s.owner_id IS NULL OR s.owner_id = $1)
        AND s.id <> $2
        AND NOT EXISTS (
          SELECT 1 FROM ai_conversations conv
          WHERE conv.user_id = $1
            AND conv.scenario_id = s.id
            AND conv.status = 'DONE'
        )
      ORDER BY
        (CASE
           WHEN NOT (
             s.access_tier = 'premium' AND $3 = false
             AND NOT EXISTS (SELECT 1 FROM user_scenario_access usa
                             WHERE usa.user_id = $1 AND usa.scenario_id = s.id)
           ) AND ($4::uuid IS NOT NULL AND s.category_id = $4::uuid) THEN 1
           WHEN NOT (
             s.access_tier = 'premium' AND $3 = false
             AND NOT EXISTS (SELECT 1 FROM user_scenario_access usa
                             WHERE usa.user_id = $1 AND usa.scenario_id = s.id)
           ) THEN 2
           WHEN ($4::uuid IS NOT NULL AND s.category_id = $4::uuid) THEN 3
           ELSE 4
         END) ASC,
        s.order_index ASC,
        s.created_at DESC
      LIMIT 2
    `;

    const rows: Array<{
      id: string;
      title: string;
      description: string | null;
      image_url: string | null;
      access_tier: AccessTier;
      category_pk: string | null;
      category_name: string | null;
      is_locked: boolean;
    }> = await this.scenarioRepo.query(sql, [
      userId,
      anchorScenarioId,
      isPremium,
      anchorCategoryId,
      languageId,
    ]);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      image_url: r.image_url,
      access_tier: r.access_tier,
      category: r.category_pk ? { id: r.category_pk, name: r.category_name! } : null,
      is_locked: r.is_locked,
    }));
  }
}
