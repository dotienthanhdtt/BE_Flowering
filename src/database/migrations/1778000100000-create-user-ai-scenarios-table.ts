import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserAiScenariosTable1778000100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`CREATE INDEX idx_user_ai_scenarios_user_lang ON user_ai_scenarios(user_id, language_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_ai_scenarios`);
  }
}
