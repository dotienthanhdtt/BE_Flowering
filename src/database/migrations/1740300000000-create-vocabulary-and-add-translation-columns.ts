import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVocabularyAndAddTranslationColumns1740300000000 implements MigrationInterface {
  name = 'CreateVocabularyAndAddTranslationColumns1740300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create vocabulary table
    await queryRunner.query(`
      CREATE TABLE "vocabulary" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "word" varchar(255) NOT NULL,
        "translation" varchar(255) NOT NULL,
        "source_lang" varchar(10) NOT NULL,
        "target_lang" varchar(10) NOT NULL,
        "part_of_speech" varchar(50),
        "pronunciation" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabulary" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_vocabulary_user_word_langs" UNIQUE ("user_id", "word", "source_lang", "target_lang"),
        CONSTRAINT "FK_vocabulary_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Index on user_id for fast lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_vocabulary_user_id" ON "vocabulary" ("user_id")
    `);

    // RLS policy for vocabulary (user data isolation)
    await queryRunner.query(`
      ALTER TABLE "vocabulary" ENABLE ROW LEVEL SECURITY
    `);
    await queryRunner.query(`
      CREATE POLICY "vocabulary_user_isolation" ON "vocabulary"
        USING ("user_id" = current_setting('app.current_user_id', true)::uuid)
    `);

    // Add translation columns to ai_conversation_messages
    await queryRunner.query(`
      ALTER TABLE "ai_conversation_messages"
      ADD COLUMN "translated_content" text,
      ADD COLUMN "translated_lang" varchar(10)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove translation columns from ai_conversation_messages
    await queryRunner.query(`
      ALTER TABLE "ai_conversation_messages"
      DROP COLUMN "translated_content",
      DROP COLUMN "translated_lang"
    `);

    // Drop vocabulary table (cascades policies and indexes)
    await queryRunner.query(`DROP TABLE "vocabulary"`);
  }
}
