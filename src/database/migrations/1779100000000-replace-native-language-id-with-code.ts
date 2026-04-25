import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceNativeLanguageIdWithCode1779100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS native_language VARCHAR(10)`);
    await queryRunner.query(
      `UPDATE users u SET native_language = l.code FROM languages l WHERE u.native_language_id = l.id`,
    );
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS native_language_id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN native_language_id UUID REFERENCES languages(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `UPDATE users u SET native_language_id = l.id FROM languages l WHERE u.native_language = l.code`,
    );
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS native_language`);
  }
}
