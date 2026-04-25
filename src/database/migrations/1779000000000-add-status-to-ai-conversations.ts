import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusToAiConversations1779000000000 implements MigrationInterface {
  name = 'AddStatusToAiConversations1779000000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`CREATE TYPE "scenario_chat_status_enum" AS ENUM ('CHATTING', 'DONE')`);

    await qr.query(`
      ALTER TABLE "ai_conversations"
      ADD COLUMN "status" "scenario_chat_status_enum" NOT NULL DEFAULT 'CHATTING'
    `);

    await qr.query(`
      UPDATE "ai_conversations"
      SET "status" = CASE
        WHEN metadata->>'completed' = 'true' THEN 'DONE'::scenario_chat_status_enum
        ELSE 'CHATTING'::scenario_chat_status_enum
      END
    `);

    await qr.query(
      `UPDATE "ai_conversations" SET metadata = metadata - 'completed' WHERE metadata ? 'completed'`,
    );

    await qr.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);
    await qr.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
        ON "ai_conversations" ("user_id", "scenario_id")
        WHERE "scenario_id" IS NOT NULL AND "status" = 'CHATTING'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS "UQ_ai_conversations_user_scenario_active"`);

    await qr.query(`
      UPDATE "ai_conversations"
      SET metadata = COALESCE(metadata, '{}'::jsonb) ||
        jsonb_build_object('completed', "status" = 'DONE')
    `);

    await qr.query(`ALTER TABLE "ai_conversations" DROP COLUMN "status"`);
    await qr.query(`DROP TYPE "scenario_chat_status_enum"`);

    await qr.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active"
        ON "ai_conversations" ("user_id", "scenario_id")
        WHERE "scenario_id" IS NOT NULL
          AND (metadata->>'completed')::boolean IS DISTINCT FROM true
    `);
  }
}
