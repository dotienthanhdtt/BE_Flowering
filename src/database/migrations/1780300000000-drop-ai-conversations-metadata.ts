import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropAiConversationsMetadata1780300000000 implements MigrationInterface {
  name = 'DropAiConversationsMetadata1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // a. Add new columns
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
        ADD COLUMN "max_turns" int NOT NULL DEFAULT 12,
        ADD COLUMN "native_language" varchar(10) NULL
    `);

    // b. Backfill max_turns from metadata for scenario rows.
    //    Guarded against non-numeric / missing values; column already has DEFAULT 12.
    await queryRunner.query(`
      UPDATE "ai_conversations"
      SET "max_turns" = ("metadata"->>'maxTurns')::int
      WHERE "scenario_id" IS NOT NULL
        AND "metadata" IS NOT NULL
        AND "metadata" ? 'maxTurns'
        AND "metadata"->>'maxTurns' ~ '^[0-9]+$'
    `);

    // c. Backfill native_language from metadata for anonymous onboarding rows
    await queryRunner.query(`
      UPDATE "ai_conversations"
      SET "native_language" = "metadata"->>'nativeLanguage'
      WHERE "type" = 'anonymous' AND "metadata" ? 'nativeLanguage'
    `);

    // d. Drop old partial unique index (keyed on metadata.completed)
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);

    // e. Recreate partial unique index keyed on status
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
        ON "ai_conversations" ("user_id", "scenario_id")
        WHERE "scenario_id" IS NOT NULL AND "status" != 'DONE'
    `);

    // f. Drop the metadata column
    await queryRunner.query(`ALTER TABLE "ai_conversations" DROP COLUMN "metadata"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add metadata column.
    await queryRunner.query(`ALTER TABLE "ai_conversations" ADD COLUMN "metadata" jsonb`);

    // Reconstruct metadata from typed columns so the legacy partial unique
    // index (keyed on metadata->>'completed') has correct semantics. Without
    // this reconstruction, every row would qualify as "active" and concurrent
    // inserts on (user_id, scenario_id) would 23505.
    await queryRunner.query(`
      UPDATE "ai_conversations"
      SET "metadata" = jsonb_build_object('maxTurns', "max_turns")
      WHERE "scenario_id" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "ai_conversations"
      SET "metadata" = COALESCE("metadata", '{}'::jsonb)
                       || jsonb_build_object('completed', true)
      WHERE "scenario_id" IS NOT NULL AND "status" = 'DONE'
    `);

    await queryRunner.query(`
      UPDATE "ai_conversations"
      SET "metadata" = COALESCE("metadata", '{}'::jsonb)
                       || jsonb_build_object('nativeLanguage', "native_language")
      WHERE "type" = 'anonymous' AND "native_language" IS NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
        ON "ai_conversations" ("user_id", "scenario_id")
        WHERE "scenario_id" IS NOT NULL
          AND ("metadata"->>'completed')::boolean IS DISTINCT FROM true
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
        DROP COLUMN "max_turns",
        DROP COLUMN "native_language"
    `);
  }
}
