import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameRevenuecatIdAndAddAutoResume1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'subscriptions' AND column_name = 'revenuecat_id'
        ) THEN
          ALTER TABLE subscriptions RENAME COLUMN revenuecat_id TO app_user_id;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_resume_at TIMESTAMPTZ NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS auto_resume_at`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'subscriptions' AND column_name = 'app_user_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'subscriptions' AND column_name = 'revenuecat_id'
        ) THEN
          ALTER TABLE subscriptions RENAME COLUMN app_user_id TO revenuecat_id;
        END IF;
      END $$;
    `);
  }
}
