import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceIsAdminWithRoles1778000300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN roles text[] NOT NULL DEFAULT ARRAY['user']::text[]`);
    await queryRunner.query(`UPDATE users SET roles = ARRAY['admin','user']::text[] WHERE is_admin = true`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS is_admin`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE users SET is_admin = true WHERE 'admin' = ANY(roles)`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS roles`);
  }
}
