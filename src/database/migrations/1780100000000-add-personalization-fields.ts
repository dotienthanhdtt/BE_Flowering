import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds personalization fields needed for auto-generate personalized scenarios.
 * All changes are additive — zero downtime.
 *
 * - Extends access_tier with 'premium_plus'
 * - Extends ai_conversation_type_enum with 'personalize_intake'
 * - Adds 3 columns to users (trial tracking, snapshot)
 * - Adds triggers_personalization bool to scenarios (partial index for lookup)
 */
export class AddPersonalizationFields1780100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum extensions must commit before they can be used. Each ALTER TYPE ADD VALUE
    // is its own statement; TypeORM wraps migrations in transactions but Postgres
    // allows reading new enum values after the statement commits within the txn.
    await queryRunner.query(`ALTER TYPE access_tier ADD VALUE IF NOT EXISTS 'premium_plus'`);
    await queryRunner.query(
      `ALTER TYPE ai_conversation_type_enum ADD VALUE IF NOT EXISTS 'personalize_intake'`,
    );

    // User personalization tracking columns
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS personalized_trial_used_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_personalization_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS personalization_profile_snapshot JSONB
    `);

    // Scenario trigger flag
    await queryRunner.query(`
      ALTER TABLE scenarios
        ADD COLUMN IF NOT EXISTS triggers_personalization BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Partial index: only rows where flag is true (typically very few)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scenarios_triggers_personalization
        ON scenarios (id)
        WHERE triggers_personalization = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_triggers_personalization`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS triggers_personalization`);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS personalization_profile_snapshot,
        DROP COLUMN IF EXISTS last_personalization_at,
        DROP COLUMN IF EXISTS personalized_trial_used_at
    `);
    // Postgres cannot drop enum values without rebuilding the type; leave orphan values.
  }
}
