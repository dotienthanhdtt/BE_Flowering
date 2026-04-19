import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillAndEnforceAiConversationLanguageId1777000400000 implements MigrationInterface {
  name = 'BackfillAndEnforceAiConversationLanguageId1777000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: backfill rows where metadata.targetLanguage resolves to a valid language
    await queryRunner.query(`
      UPDATE "ai_conversations" ac
      SET "language_id" = l."id"
      FROM "languages" l
      WHERE ac."language_id" IS NULL
        AND ac."metadata"->>'targetLanguage' IS NOT NULL
        AND l."code" = ac."metadata"->>'targetLanguage'
        AND l."is_active" = true
    `);

    // Step 2: remaining NULLs fall back to 'en'
    const result = await queryRunner.query(`SELECT id FROM "languages" WHERE code = 'en' LIMIT 1`);
    if (!result.length) throw new Error('Default language "en" not found — seed languages table first');

    const enId = result[0].id as string;
    await queryRunner.query(
      `UPDATE "ai_conversations" SET "language_id" = $1 WHERE "language_id" IS NULL`,
      [enId],
    );

    await queryRunner.query(`ALTER TABLE "ai_conversations" ALTER COLUMN "language_id" SET NOT NULL`);

    // Update FK constraint to remove nullable semantics
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      DROP CONSTRAINT IF EXISTS "ai_conversations_language_id_fkey"
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ADD CONSTRAINT "fk_ai_conversations_language"
      FOREIGN KEY ("language_id") REFERENCES "languages"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_conversations" DROP CONSTRAINT IF EXISTS "fk_ai_conversations_language"`);
    await queryRunner.query(`ALTER TABLE "ai_conversations" ALTER COLUMN "language_id" DROP NOT NULL`);
  }
}
