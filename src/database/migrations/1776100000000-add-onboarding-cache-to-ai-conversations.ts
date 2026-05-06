import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two nullable JSONB columns to `ai_conversations` to cache the output of
 * `POST /onboarding/complete` so subsequent calls with the same conversation_id
 * return identical data (same scenario UUIDs) without re-running the LLM.
 *
 * - `extracted_profile`: parsed learner profile returned from the extraction prompt
 * - `scenarios`: the 5 OnboardingScenarioDto objects generated for the profile
 *
 * Both are NULL for existing rows; the service lazily populates them on the
 * first successful `/complete` call (profile structured AND scenarios.length === 5).
 */
export class AddOnboardingCacheToAiConversations1776100000000 implements MigrationInterface {
  name = 'AddOnboardingCacheToAiConversations1776100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ADD COLUMN "extracted_profile" JSONB NULL,
      ADD COLUMN "scenarios" JSONB NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      DROP COLUMN IF EXISTS "scenarios",
      DROP COLUMN IF EXISTS "extracted_profile"
    `);
  }
}
