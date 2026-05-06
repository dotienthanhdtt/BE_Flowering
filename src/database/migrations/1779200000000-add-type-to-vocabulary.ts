import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTypeToVocabulary1779200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE vocabulary ADD COLUMN type VARCHAR(30) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE vocabulary DROP COLUMN type`);
  }
}
