import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropIconFromScenarioCategories1776000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scenario_categories DROP COLUMN IF EXISTS icon`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scenario_categories ADD COLUMN icon TEXT`);
  }
}
