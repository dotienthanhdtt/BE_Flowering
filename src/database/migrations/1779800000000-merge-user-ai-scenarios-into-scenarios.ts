import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Step 1 of the user_ai_scenarios → scenarios merge.
 *
 * Postgres requires `ALTER TYPE ... ADD VALUE` to commit before the new value
 * can be used in the same connection. TypeORM wraps each migration in a
 * transaction, so the enum changes must land in their own migration that
 * commits before the backfill migration runs.
 */
export class MergeUserAiScenariosEnumPrep1779800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE scenario_type RENAME VALUE 'default' TO 'system'`);
    await queryRunner.query(`ALTER TYPE scenario_type ADD VALUE IF NOT EXISTS 'personal'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot drop enum values in Postgres without rebuilding the type.
    // 'personal' is left as an orphan value (harmless).
    await queryRunner.query(`ALTER TYPE scenario_type RENAME VALUE 'system' TO 'default'`);
  }
}
