import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageIdToUserProgress1777000100000 implements MigrationInterface {
  name = 'AddLanguageIdToUserProgress1777000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_progress" ADD COLUMN IF NOT EXISTS "language_id" uuid`);
    await queryRunner.query(`
      UPDATE "user_progress" up
      SET "language_id" = l."language_id"
      FROM "lessons" l
      WHERE l."id" = up."lesson_id"
        AND up."language_id" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "user_progress" ALTER COLUMN "language_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "user_progress"
      ADD CONSTRAINT "fk_user_progress_language"
      FOREIGN KEY ("language_id") REFERENCES "languages"("id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_progress_user_lang_status"
      ON "user_progress"("user_id", "language_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_progress_user_lang_status"`);
    await queryRunner.query(`ALTER TABLE "user_progress" DROP CONSTRAINT IF EXISTS "fk_user_progress_language"`);
    await queryRunner.query(`ALTER TABLE "user_progress" DROP COLUMN IF EXISTS "language_id"`);
  }
}
