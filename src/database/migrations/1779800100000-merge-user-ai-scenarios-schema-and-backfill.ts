import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Step 2 of the user_ai_scenarios → scenarios merge. Runs after the enum prep
 * migration commits the 'personal' value.
 */
export class MergeUserAiScenariosSchemaAndBackfill1779800100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Schema changes on scenarios.
    await queryRunner.query(`ALTER TABLE scenarios ALTER COLUMN category_id DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE scenarios
      ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
      ADD COLUMN source_conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_scenarios_owner_lang
      ON scenarios(owner_id, language_id)
      WHERE type = 'personal'
    `);

    // 2. Backfill personal rows from user_ai_scenarios. Preserve UUIDs so
    //    existing references (e.g. mobile cached IDs, ai_conversations rows
    //    that may be created post-fix) keep working.
    await queryRunner.query(`
      INSERT INTO scenarios (
        id, category_id, language_id, creator_id, owner_id, source_conversation_id,
        type, title, description, image_url, difficulty, access_tier, status,
        order_index, created_at, updated_at
      )
      SELECT
        id, NULL, language_id, NULL, user_id, conversation_id,
        'personal', title, description, NULL, difficulty, 'free', 'published',
        0, created_at, created_at
      FROM user_ai_scenarios
      ON CONFLICT (id) DO NOTHING
    `);

    // 3. CHECK constraint enforcing the type/owner_id/category_id contract.
    //    Added after backfill so existing rows do not violate.
    await queryRunner.query(`
      ALTER TABLE scenarios ADD CONSTRAINT scenarios_type_owner_check CHECK (
        (type = 'personal' AND owner_id IS NOT NULL AND category_id IS NULL)
        OR
        (type IN ('system','kol') AND owner_id IS NULL AND category_id IS NOT NULL)
      )
    `);

    // 4. Drop legacy table.
    await queryRunner.query(`DROP TABLE IF EXISTS user_ai_scenarios`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate legacy table.
    await queryRunner.query(`
      CREATE TABLE user_ai_scenarios (
        id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        language_id UUID NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
        conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        difficulty scenario_difficulty NOT NULL DEFAULT 'beginner',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_user_ai_scenarios_user_lang ON user_ai_scenarios(user_id, language_id)`,
    );

    // Copy personal scenarios back.
    await queryRunner.query(`
      INSERT INTO user_ai_scenarios (id, user_id, language_id, conversation_id, title, description, difficulty, created_at)
      SELECT id, owner_id, language_id, source_conversation_id, title, description, difficulty, created_at
      FROM scenarios
      WHERE type = 'personal'
    `);

    // Drop CHECK + new columns + index + remove personal rows from scenarios.
    await queryRunner.query(
      `ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_type_owner_check`,
    );
    await queryRunner.query(`DELETE FROM scenarios WHERE type = 'personal'`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_owner_lang`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS source_conversation_id`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS owner_id`);
    await queryRunner.query(`ALTER TABLE scenarios ALTER COLUMN category_id SET NOT NULL`);
  }
}
