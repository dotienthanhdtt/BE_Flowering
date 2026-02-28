import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNativeLearningFlagsToLanguages1740200000000
  implements MigrationInterface
{
  name = 'AddNativeLearningFlagsToLanguages1740200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "languages"
      ADD COLUMN "is_native_available" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN "is_learning_available" BOOLEAN NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "languages"
      DROP COLUMN "is_native_available",
      DROP COLUMN "is_learning_available"
    `);
  }
}
