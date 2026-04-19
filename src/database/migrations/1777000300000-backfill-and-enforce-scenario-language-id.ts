import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillAndEnforceScenarioLanguageId1777000300000 implements MigrationInterface {
  name = 'BackfillAndEnforceScenarioLanguageId1777000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(`SELECT id FROM "languages" WHERE code = 'en' LIMIT 1`);
    if (!result.length) throw new Error('Default language "en" not found — seed languages table first');

    const enId = result[0].id as string;
    await queryRunner.query(
      `UPDATE "scenarios" SET "language_id" = $1 WHERE "language_id" IS NULL`,
      [enId],
    );
    await queryRunner.query(`ALTER TABLE "scenarios" ALTER COLUMN "language_id" SET NOT NULL`);

    // Change ON DELETE SET NULL to ON DELETE RESTRICT now that column is required
    await queryRunner.query(`
      ALTER TABLE "scenarios"
      DROP CONSTRAINT IF EXISTS "scenarios_language_id_fkey"
    `);
    await queryRunner.query(`
      ALTER TABLE "scenarios"
      ADD CONSTRAINT "fk_scenarios_language"
      FOREIGN KEY ("language_id") REFERENCES "languages"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" DROP CONSTRAINT IF EXISTS "fk_scenarios_language"`);
    await queryRunner.query(`ALTER TABLE "scenarios" ALTER COLUMN "language_id" DROP NOT NULL`);
  }
}
