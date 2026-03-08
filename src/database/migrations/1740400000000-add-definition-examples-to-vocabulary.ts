import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefinitionExamplesToVocabulary1740400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vocabulary"
      ADD COLUMN "definition" text,
      ADD COLUMN "examples" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vocabulary"
      DROP COLUMN "examples",
      DROP COLUMN "definition"
    `);
  }
}
