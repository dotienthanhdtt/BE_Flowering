import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusToContentTables1777000500000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE content_status AS ENUM ('draft', 'published', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE lessons
        ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'published';
    `);
    await queryRunner.query(`
      ALTER TABLE exercises
        ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'published';
    `);
    await queryRunner.query(`
      ALTER TABLE scenarios
        ADD COLUMN IF NOT EXISTS status content_status NOT NULL DEFAULT 'published';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios(status);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_scenarios_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_exercises_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_lessons_status;`);

    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN IF EXISTS status;`);
    await queryRunner.query(`ALTER TABLE exercises DROP COLUMN IF EXISTS status;`);
    await queryRunner.query(`ALTER TABLE lessons DROP COLUMN IF EXISTS status;`);

    await queryRunner.query(`DROP TYPE IF EXISTS content_status;`);
  }
}
