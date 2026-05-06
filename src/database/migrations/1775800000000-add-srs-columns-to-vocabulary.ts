import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSrsColumnsToVocabulary1775800000000 implements MigrationInterface {
  name = 'AddSrsColumnsToVocabulary1775800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vocabulary"
        ADD COLUMN "box" smallint NOT NULL DEFAULT 1,
        ADD COLUMN "due_at" timestamptz NOT NULL DEFAULT NOW(),
        ADD COLUMN "last_reviewed_at" timestamptz NULL,
        ADD COLUMN "review_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "correct_count" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(
      `ALTER TABLE "vocabulary" ADD CONSTRAINT "vocabulary_box_check" CHECK ("box" BETWEEN 1 AND 5)`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_vocabulary_user_due" ON "vocabulary" ("user_id", "due_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_vocabulary_user_due"`);
    await queryRunner.query(
      `ALTER TABLE "vocabulary" DROP CONSTRAINT IF EXISTS "vocabulary_box_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vocabulary"
        DROP COLUMN IF EXISTS "correct_count",
        DROP COLUMN IF EXISTS "review_count",
        DROP COLUMN IF EXISTS "last_reviewed_at",
        DROP COLUMN IF EXISTS "due_at",
        DROP COLUMN IF EXISTS "box"
    `);
  }
}
