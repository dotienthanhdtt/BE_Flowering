import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserLanguagesLevelTrigger1779600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE user_languages ALTER COLUMN proficiency_level DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE user_languages ALTER COLUMN proficiency_level DROP NOT NULL`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION user_languages_resolve_level() RETURNS trigger AS $$
      DECLARE fw TEXT;
      BEGIN
        SELECT level_framework INTO fw FROM languages WHERE id = NEW.language_id;
        IF fw IS NULL THEN
          RAISE EXCEPTION 'Language % has no level_framework', NEW.language_id;
        END IF;

        IF NEW.proficiency_level IS NULL THEN
          SELECT level_code INTO NEW.proficiency_level
          FROM framework_levels
          WHERE framework_code = fw
          ORDER BY order_index ASC
          LIMIT 1;
          IF NEW.proficiency_level IS NULL THEN
            RAISE EXCEPTION 'No framework_levels seeded for %', fw;
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM framework_levels
          WHERE framework_code = fw AND level_code = NEW.proficiency_level
        ) THEN
          RAISE EXCEPTION 'Invalid level % for framework %', NEW.proficiency_level, fw;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_user_languages_resolve_level ON user_languages;
      CREATE TRIGGER trg_user_languages_resolve_level
        BEFORE INSERT OR UPDATE OF proficiency_level ON user_languages
        FOR EACH ROW EXECUTE FUNCTION user_languages_resolve_level();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_user_languages_resolve_level ON user_languages`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS user_languages_resolve_level()`);
    await queryRunner.query(
      `ALTER TABLE user_languages ALTER COLUMN proficiency_level SET DEFAULT 'A1'`,
    );
    await queryRunner.query(
      `UPDATE user_languages SET proficiency_level = 'A1' WHERE proficiency_level IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE user_languages ALTER COLUMN proficiency_level SET NOT NULL`,
    );
  }
}
