import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTypeToScenariosDropGiftCode1778000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE scenario_type AS ENUM ('default', 'kol')`);
    await queryRunner.query(`ALTER TABLE scenarios ADD COLUMN type scenario_type NOT NULL DEFAULT 'default'`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS gift_code`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS type`);
    await queryRunner.query(`DROP TYPE IF EXISTS scenario_type`);
    await queryRunner.query(`ALTER TABLE scenarios ADD COLUMN gift_code VARCHAR(50) UNIQUE`);
  }
}
