import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingToAiConversations1740000000000
  implements MigrationInterface
{
  name = 'AddOnboardingToAiConversations1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create enum type
    await queryRunner.query(`
      CREATE TYPE "ai_conversation_type_enum"
      AS ENUM ('anonymous', 'authenticated')
    `);

    // 2. Make user_id nullable (anonymous sessions have no user)
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "user_id" DROP NOT NULL
    `);

    // 3. Make language_id nullable (anonymous sessions have no language record)
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "language_id" DROP NOT NULL
    `);

    // 4. Add new columns
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ADD COLUMN "session_token" VARCHAR(255),
      ADD COLUMN "type" "ai_conversation_type_enum"
        DEFAULT 'authenticated' NOT NULL,
      ADD COLUMN "expires_at" TIMESTAMPTZ
    `);

    // 5. Create partial unique index on session_token (NULL values excluded)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ai_conversations_session_token"
      ON "ai_conversations" ("session_token")
      WHERE "session_token" IS NOT NULL
    `);

    // 6. Create index on type for filtering
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_conversations_type"
      ON "ai_conversations" ("type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_session_token"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      DROP COLUMN IF EXISTS "expires_at",
      DROP COLUMN IF EXISTS "type",
      DROP COLUMN IF EXISTS "session_token"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "ai_conversation_type_enum"
    `);
    // Restore NOT NULL constraints only after removing anonymous rows
    await queryRunner.query(`
      DELETE FROM "ai_conversations" WHERE "user_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "user_id" SET NOT NULL
    `);
    await queryRunner.query(`
      DELETE FROM "ai_conversations" WHERE "language_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "language_id" SET NOT NULL
    `);
  }
}
