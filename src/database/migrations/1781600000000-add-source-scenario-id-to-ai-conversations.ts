import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3: add nullable source_scenario_id FK to ai_conversations.
 * Used by personalization trigger flow to inherit category from source scenario.
 */
export class AddSourceScenarioIdToAiConversations1781600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_conversations
        ADD COLUMN IF NOT EXISTS source_scenario_id UUID NULL
        REFERENCES scenarios(id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_conversations_source_scenario_id
        ON ai_conversations(source_scenario_id)
        WHERE source_scenario_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_ai_conversations_source_scenario_id`,
    );
    await queryRunner.query(
      `ALTER TABLE ai_conversations DROP COLUMN IF EXISTS source_scenario_id`,
    );
  }
}
