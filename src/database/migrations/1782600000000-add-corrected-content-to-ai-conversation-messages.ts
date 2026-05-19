import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds corrected_content column to persist grammar/vocabulary corrections
 * produced by POST /ai/chat/correct. Nullable text — null means either
 * "no errors found" or "correction not yet run".
 */
export class AddCorrectedContentToAiConversationMessages1782600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" ADD COLUMN IF NOT EXISTS "corrected_content" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" DROP COLUMN IF EXISTS "corrected_content"`,
    );
  }
}
