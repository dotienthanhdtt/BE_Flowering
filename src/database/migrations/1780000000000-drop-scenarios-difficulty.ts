import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropScenariosDifficulty1780000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_difficulty`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS difficulty`);
    await queryRunner.query(`DROP TYPE IF EXISTS scenario_difficulty`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE scenario_difficulty AS ENUM ('beginner', 'intermediate', 'advanced')`,
    );
    await queryRunner.query(
      `ALTER TABLE scenarios ADD COLUMN difficulty scenario_difficulty NOT NULL DEFAULT 'beginner'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_scenarios_difficulty ON scenarios(difficulty)`,
    );
  }
}
