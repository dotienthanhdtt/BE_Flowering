import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueUserScenarioConversationIndex1775700100000 implements MigrationInterface {
  name = 'AddUniqueUserScenarioConversationIndex1775700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial unique index: only one active (non-completed) conversation per (user, scenario).
    // Rows where scenario_id IS NULL (non-scenario conversations) are excluded intentionally.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
        ON "ai_conversations" ("user_id", "scenario_id")
        WHERE "scenario_id" IS NOT NULL
          AND (metadata->>'completed')::boolean IS DISTINCT FROM true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`,
    );
  }
}
