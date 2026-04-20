import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKolBundlesTables1778000200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE kol_bundles (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        gift_code VARCHAR(50) NOT NULL UNIQUE,
        creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_kol_bundles_creator ON kol_bundles(creator_id)`);
    await queryRunner.query(`
      CREATE TABLE kol_bundle_scenarios (
        bundle_id UUID NOT NULL REFERENCES kol_bundles(id) ON DELETE CASCADE,
        scenario_id UUID NOT NULL UNIQUE REFERENCES scenarios(id) ON DELETE CASCADE,
        PRIMARY KEY (bundle_id, scenario_id)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS kol_bundle_scenarios`);
    await queryRunner.query(`DROP TABLE IF EXISTS kol_bundles`);
  }
}
