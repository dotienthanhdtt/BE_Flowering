import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirebaseUidToUsers1775300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN firebase_uid VARCHAR(128) UNIQUE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN firebase_uid;
    `);
  }
}
