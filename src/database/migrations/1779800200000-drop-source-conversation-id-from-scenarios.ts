import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSourceConversationIdFromScenarios1779800200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS source_conversation_id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scenarios
      ADD COLUMN source_conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL
    `);
  }
}
