import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameUserLanguageIsActiveToLastLearned1779400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_languages RENAME COLUMN is_active TO last_learned`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_languages RENAME COLUMN last_learned TO is_active`);
  }
}