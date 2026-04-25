import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVocabInjectionCacheAndIndexes1778100000000 implements MigrationInterface {
  name = 'AddVocabInjectionCacheAndIndexes1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "injected_vocab_ids" uuid[] NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_vocab_user_lang_last_reviewed" ON "vocabulary" ("user_id", "target_lang", "last_reviewed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_vocab_user_lang_due_box" ON "vocabulary" ("user_id", "target_lang", "due_at", "box")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_vocab_user_lang_due_box"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_vocab_user_lang_last_reviewed"`);
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "injected_vocab_ids"`,
    );
  }
}
