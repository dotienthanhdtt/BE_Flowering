import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVocabularyInjectionEventsTable1778100100000 implements MigrationInterface {
  name = 'CreateVocabularyInjectionEventsTable1778100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vocabulary_injection_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
        "vocabulary_id" uuid NOT NULL REFERENCES "vocabulary"("id") ON DELETE CASCADE,
        "turn_index" smallint NOT NULL,
        "was_used" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_vocab_inj_events_conv" ON "vocabulary_injection_events" ("conversation_id")`);
    await queryRunner.query(`CREATE INDEX "idx_vocab_inj_events_vocab" ON "vocabulary_injection_events" ("vocabulary_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vocabulary_injection_events"`);
  }
}
