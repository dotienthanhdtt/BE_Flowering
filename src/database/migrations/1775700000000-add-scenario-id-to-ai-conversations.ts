import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioIdToAiConversations1775700000000 implements MigrationInterface {
  name = 'AddScenarioIdToAiConversations1775700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "scenario_id" uuid NULL REFERENCES "scenarios"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_conversations_user_scenario" ON "ai_conversations"("user_id", "scenario_id") WHERE "scenario_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_conversations_user_scenario"`);
    await queryRunner.query(`ALTER TABLE "ai_conversations" DROP COLUMN "scenario_id"`);
  }
}
