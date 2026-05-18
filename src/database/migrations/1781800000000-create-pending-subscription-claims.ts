import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePendingSubscriptionClaims1781800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pending_subscription_claims (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id            VARCHAR(255) NOT NULL,
        rc_app_user_id      VARCHAR(255) NOT NULL,
        event_type          VARCHAR(50)  NOT NULL,
        event_timestamp_ms  BIGINT       NULL,
        event_payload       JSONB        NOT NULL,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        claimed_at          TIMESTAMPTZ  NULL,
        claimed_by_user     UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_psc_event_id UNIQUE (event_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_psc_rc_app_user_id_unclaimed
        ON pending_subscription_claims (rc_app_user_id)
        WHERE claimed_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_psc_event_timestamp_created
        ON pending_subscription_claims (event_timestamp_ms ASC NULLS LAST, created_at ASC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pending_subscription_claims`);
  }
}
