import { MigrationInterface, QueryRunner } from 'typeorm';

export class MergeVocabularyTypeIntoPartOfSpeech1779300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "vocabulary" SET "part_of_speech" = "type" WHERE "part_of_speech" IS NULL AND "type" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "vocabulary" DROP COLUMN "type"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vocabulary" ADD COLUMN "type" VARCHAR(30) NULL`);
  }
}
