import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokensTable1738678500000
  implements MigrationInterface
{
  name = 'CreateRefreshTokensTable1738678500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
        "token_hash" varchar(255) NOT NULL,
        "user_id" uuid NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked" boolean DEFAULT false NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_user_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_tokens_token_hash"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
