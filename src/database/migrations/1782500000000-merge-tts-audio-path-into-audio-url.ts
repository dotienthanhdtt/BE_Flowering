import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses tts_audio_path into audio_url. After this migration, audio_url
 * stores the object-storage key for both user-role STT recordings and
 * assistant-role TTS synthesis. URLs are minted on read via
 * ObjectStorageService.getSignedUrl(path) so cache hits never expire.
 */
export class MergeTtsAudioPathIntoAudioUrl1782500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ai_conversation_messages"
         SET "audio_url" = "tts_audio_path"
       WHERE "tts_audio_path" IS NOT NULL AND "audio_url" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" DROP COLUMN IF EXISTS "tts_audio_path"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversation_messages" ADD COLUMN IF NOT EXISTS "tts_audio_path" TEXT NULL`,
    );
    // Best-effort split: copy assistant-role audio_url back to tts_audio_path.
    await queryRunner.query(
      `UPDATE "ai_conversation_messages"
         SET "tts_audio_path" = "audio_url"
       WHERE "role" = 'assistant' AND "audio_url" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "ai_conversation_messages"
         SET "audio_url" = NULL
       WHERE "role" = 'assistant'`,
    );
  }
}
