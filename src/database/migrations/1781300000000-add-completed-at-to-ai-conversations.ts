import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompletedAtToAiConversations1781300000000 implements MigrationInterface {
  name = 'AddCompletedAtToAiConversations1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "completed_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "completed_at"`,
    );
  }
}
