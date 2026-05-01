import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventTimestampMsToSubscriptions1779900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS event_timestamp_ms BIGINT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS event_timestamp_ms`);
  }
}
