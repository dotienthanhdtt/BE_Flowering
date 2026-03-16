import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookEventsTable1740500000000 implements MigrationInterface {
  name = 'CreateWebhookEventsTable1740500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_events;`);
  }
}
