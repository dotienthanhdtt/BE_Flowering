import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSessionTokenFromAiConversations1772277787400 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_conversations_session_token"`);
    await queryRunner.query(`ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "session_token"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "session_token" VARCHAR(255)`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ai_conversations_session_token"
      ON "ai_conversations" ("session_token")
      WHERE "session_token" IS NOT NULL
    `);
  }
}
