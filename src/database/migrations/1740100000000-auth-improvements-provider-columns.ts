import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthImprovementsProviderColumns1740100000000 implements MigrationInterface {
  name = 'AuthImprovementsProviderColumns1740100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add provider-specific columns to users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "google_provider_id" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "apple_provider_id" VARCHAR(255)
    `);

    // 2. Create unique indexes (partial, excludes NULLs)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_google_provider_id"
      ON "users" ("google_provider_id")
      WHERE "google_provider_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_apple_provider_id"
      ON "users" ("apple_provider_id")
      WHERE "apple_provider_id" IS NOT NULL
    `);

    // 3. Migrate existing provider data to new columns
    await queryRunner.query(`
      UPDATE "users"
      SET "google_provider_id" = "provider_id"
      WHERE "auth_provider" = 'google' AND "provider_id" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "apple_provider_id" = "provider_id"
      WHERE "auth_provider" = 'apple' AND "provider_id" IS NOT NULL
    `);

    // 4. Force-revoke all existing refresh tokens (clean break for composite format)
    await queryRunner.query(`
      UPDATE "refresh_tokens"
      SET "revoked" = true
      WHERE "revoked" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_google_provider_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_apple_provider_id"`);
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "google_provider_id",
      DROP COLUMN IF EXISTS "apple_provider_id"
    `);
    // Note: cannot un-revoke tokens — acceptable for down migration
  }
}
