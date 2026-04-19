import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorContentAccessTier1777001000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type (guarded against duplicate)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE access_tier AS ENUM ('free', 'premium');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Add access_tier column to both tables
    await queryRunner.query(`
      ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS access_tier access_tier NOT NULL DEFAULT 'free';
    `);
    await queryRunner.query(`
      ALTER TABLE lessons ADD COLUMN IF NOT EXISTS access_tier access_tier NOT NULL DEFAULT 'free';
    `);

    // Backfill scenarios: premium=true AND trial=false → 'premium', else 'free'
    await queryRunner.query(`
      UPDATE scenarios SET access_tier = 'premium' WHERE is_premium = true AND is_trial = false;
    `);
    // Backfill lessons: premium=true → 'premium'
    await queryRunner.query(`
      UPDATE lessons SET access_tier = 'premium' WHERE is_premium = true;
    `);

    // Map is_active=false → status='archived' for both tables
    await queryRunner.query(`
      UPDATE scenarios SET status = 'archived' WHERE is_active = false;
    `);
    await queryRunner.query(`
      UPDATE lessons SET status = 'archived' WHERE is_active = false;
    `);

    // Drop old index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_active;`);

    // Drop old bool columns from scenarios (is_premium, is_trial, is_active)
    await queryRunner.query(`
      ALTER TABLE scenarios
        DROP COLUMN IF EXISTS is_premium,
        DROP COLUMN IF EXISTS is_trial,
        DROP COLUMN IF EXISTS is_active;
    `);

    // Drop old bool columns from lessons (is_premium, is_active)
    await queryRunner.query(`
      ALTER TABLE lessons
        DROP COLUMN IF EXISTS is_premium,
        DROP COLUMN IF EXISTS is_active;
    `);

    // Add new indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scenarios_access_tier ON scenarios(access_tier);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_access_tier ON lessons(access_tier);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_lessons_access_tier;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_access_tier;`);

    // Restore bool columns to scenarios
    await queryRunner.query(`
      ALTER TABLE scenarios
        ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_trial   BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT true;
    `);
    // Restore bool columns to lessons
    await queryRunner.query(`
      ALTER TABLE lessons
        ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT true;
    `);

    // Backfill from access_tier + status
    await queryRunner.query(`
      UPDATE scenarios SET
        is_premium = (access_tier = 'premium'),
        is_active  = (status <> 'archived');
    `);
    await queryRunner.query(`
      UPDATE lessons SET
        is_premium = (access_tier = 'premium'),
        is_active  = (status <> 'archived');
    `);

    // Drop access_tier columns
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS access_tier;`);
    await queryRunner.query(`ALTER TABLE lessons DROP COLUMN IF EXISTS access_tier;`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS access_tier;`);

    // Restore old index
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scenarios_active ON scenarios(is_active);
    `);
  }
}
