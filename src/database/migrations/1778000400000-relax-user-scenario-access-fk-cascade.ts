import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxUserScenarioAccessFkCascade1778000400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'user_scenario_access'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%scenario_id%'
    `);
    if (result.length > 0) {
      const constraintName: string = result[0].constraint_name;
      await queryRunner.query(
        `ALTER TABLE user_scenario_access DROP CONSTRAINT "${constraintName}"`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE user_scenario_access
        ADD CONSTRAINT user_scenario_access_scenario_id_fkey
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE user_scenario_access DROP CONSTRAINT IF EXISTS user_scenario_access_scenario_id_fkey`,
    );
    await queryRunner.query(`
      ALTER TABLE user_scenario_access
        ADD CONSTRAINT user_scenario_access_scenario_id_fkey
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    `);
  }
}
