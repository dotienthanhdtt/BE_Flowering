import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageIdToUserExerciseAttempts1777000200000 implements MigrationInterface {
  name = 'AddLanguageIdToUserExerciseAttempts1777000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_exercise_attempts" ADD COLUMN IF NOT EXISTS "language_id" uuid`);
    await queryRunner.query(`
      UPDATE "user_exercise_attempts" uea
      SET "language_id" = l."language_id"
      FROM "exercises" e
      JOIN "lessons" l ON l."id" = e."lesson_id"
      WHERE e."id" = uea."exercise_id"
        AND uea."language_id" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "user_exercise_attempts" ALTER COLUMN "language_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "user_exercise_attempts"
      ADD CONSTRAINT "fk_user_exercise_attempts_language"
      FOREIGN KEY ("language_id") REFERENCES "languages"("id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_exercise_attempts_user_lang"
      ON "user_exercise_attempts"("user_id", "language_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_exercise_attempts_user_lang"`);
    await queryRunner.query(`ALTER TABLE "user_exercise_attempts" DROP CONSTRAINT IF EXISTS "fk_user_exercise_attempts_language"`);
    await queryRunner.query(`ALTER TABLE "user_exercise_attempts" DROP COLUMN IF EXISTS "language_id"`);
  }
}
