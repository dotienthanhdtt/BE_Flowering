import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenariosTables1775500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type
    await queryRunner.query(`
      CREATE TYPE scenario_difficulty AS ENUM ('beginner', 'intermediate', 'advanced')
    `);

    // Create scenario_categories table
    await queryRunner.query(`
      CREATE TABLE scenario_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        icon TEXT,
        order_index INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create scenarios table
    await queryRunner.query(`
      CREATE TABLE scenarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID NOT NULL REFERENCES scenario_categories(id) ON DELETE CASCADE,
        language_id UUID REFERENCES languages(id) ON DELETE SET NULL,
        creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
        gift_code VARCHAR(50) UNIQUE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        image_url TEXT,
        difficulty scenario_difficulty NOT NULL DEFAULT 'beginner',
        is_premium BOOLEAN NOT NULL DEFAULT false,
        is_trial BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        order_index INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create user_scenario_access table
    await queryRunner.query(`
      CREATE TABLE user_scenario_access (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, scenario_id)
      )
    `);

    // Indexes for query performance
    await queryRunner.query(`CREATE INDEX idx_scenarios_category ON scenarios(category_id)`);
    await queryRunner.query(`CREATE INDEX idx_scenarios_language ON scenarios(language_id)`);
    await queryRunner.query(`CREATE INDEX idx_scenarios_difficulty ON scenarios(difficulty)`);
    await queryRunner.query(`CREATE INDEX idx_scenarios_active ON scenarios(is_active)`);
    await queryRunner.query(
      `CREATE INDEX idx_user_scenario_access_user ON user_scenario_access(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_scenario_access`);
    await queryRunner.query(`DROP TABLE IF EXISTS scenarios`);
    await queryRunner.query(`DROP TABLE IF EXISTS scenario_categories`);
    await queryRunner.query(`DROP TYPE IF EXISTS scenario_difficulty`);
  }
}
