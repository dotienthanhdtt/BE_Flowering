import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';

/** Maximum personal scenarios retained per user. */
const PERSONAL_CAP = 30;

@Injectable()
export class PersonalizationPruneService {
  private readonly logger = new Logger(PersonalizationPruneService.name);

  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  /**
   * Lazily prune oldest UNUSED personal scenarios over the cap.
   * "Unused" = no ai_conversations rows referencing the scenario.
   * Runs after successful generation; errors are logged and swallowed.
   */
  async pruneIfNeeded(userId: string): Promise<void> {
    try {
      await this.scenarioRepo.manager.query(
        `
        DELETE FROM scenarios
        WHERE id IN (
          SELECT s.id
          FROM scenarios s
          LEFT JOIN ai_conversations c ON c.scenario_id = s.id
          WHERE s.owner_id = $1
            AND s.type = 'personal'
          GROUP BY s.id, s.created_at
          HAVING COUNT(c.id) = 0
          ORDER BY s.created_at ASC
          OFFSET $2
        )
        `,
        [userId, PERSONAL_CAP],
      );
    } catch (err) {
      this.logger.warn(`Prune failed for userId=${userId}: ${(err as Error).message}`);
    }
  }
}
