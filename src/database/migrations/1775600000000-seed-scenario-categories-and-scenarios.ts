import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  seedScenarioCategoriesQuery,
  seedScenariosQuery,
} from '../seeds/scenario-seed-data';

export class SeedScenarioCategoriesAndScenarios1775600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(seedScenarioCategoriesQuery);
    await queryRunner.query(seedScenariosQuery);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM scenarios WHERE language_id IS NULL`);
    await queryRunner.query(`DELETE FROM scenario_categories`);
  }
}
