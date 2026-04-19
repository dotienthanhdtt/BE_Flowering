import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageIdToExercises1777000000000 implements MigrationInterface {
  name = 'AddLanguageIdToExercises1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exercises" ADD COLUMN IF NOT EXISTS "language_id" uuid`);
    await queryRunner.query(`
      UPDATE "exercises" e
      SET "language_id" = l."language_id"
      FROM "lessons" l
      WHERE l."id" = e."lesson_id"
        AND e."language_id" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "exercises" ALTER COLUMN "language_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "exercises"
      ADD CONSTRAINT "fk_exercises_language"
      FOREIGN KEY ("language_id") REFERENCES "languages"("id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_exercises_language"
      ON "exercises"("language_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_exercises_language"`);
    await queryRunner.query(`ALTER TABLE "exercises" DROP CONSTRAINT IF EXISTS "fk_exercises_language"`);
    await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN IF EXISTS "language_id"`);
  }
}
