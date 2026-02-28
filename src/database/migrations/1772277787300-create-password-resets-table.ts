import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResetsTable1772277787300 implements MigrationInterface {
  name = 'CreatePasswordResetsTable1772277787300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_resets" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL,
        "otp_hash" VARCHAR(64) NOT NULL,
        "reset_token_hash" VARCHAR(64),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "reset_token_expires_at" TIMESTAMPTZ,
        "used" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_password_resets_email_created_at"
      ON "password_resets" ("email", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_password_resets_email_created_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_resets";`);
  }
}
