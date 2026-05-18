import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds tts_audio_path column to store TTS-synthesized mp3 object key (not URL).
 * Storing the storage path lets us mint fresh presigned URLs on each read so
 * cache hits never return expired signatures. Distinct from existing audio_url
 * which holds user-recorded audio from STT sessions.
 */
export class AddTtsAudioPathToAiConversationMessages1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" ADD COLUMN IF NOT EXISTS "tts_audio_path" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" DROP COLUMN IF EXISTS "tts_audio_path"`,
    );
  }
}
