import { MigrationInterface, QueryRunner } from 'typeorm';

export class FrameworkLevelsPerLanguage1779700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger first (depends on framework_levels table); function stays, recreated below
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_user_languages_resolve_level ON user_languages`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS user_languages_resolve_level()`);
    await queryRunner.query(`DROP TABLE IF EXISTS framework_levels`);

    await queryRunner.query(`
      CREATE TABLE framework_levels (
        language_id    UUID        NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
        framework_code VARCHAR(16) NOT NULL,
        level_code     VARCHAR(16) NOT NULL,
        description    TEXT        NOT NULL,
        order_index    INT         NOT NULL,
        PRIMARY KEY (language_id, level_code)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_framework_levels_framework ON framework_levels (framework_code)`,
    );

    // Fan-out seed: every language gets its framework's rows. Description = TBD placeholder
    // including the language code so admins can find/replace easily.
    await queryRunner.query(`
      INSERT INTO framework_levels (language_id, framework_code, level_code, description, order_index)
      SELECT l.id, l.level_framework, t.level_code,
             'TBD: ' || l.code || ' ' || t.level_code,
             t.order_index
      FROM languages l
      JOIN (VALUES
        ('CEFR','A1',1), ('CEFR','A2',2), ('CEFR','B1',3), ('CEFR','B2',4), ('CEFR','C1',5), ('CEFR','C2',6),
        ('JLPT','N5',1), ('JLPT','N4',2), ('JLPT','N3',3), ('JLPT','N2',4), ('JLPT','N1',5),
        ('HSK','HSK1',1), ('HSK','HSK2',2), ('HSK','HSK3',3), ('HSK','HSK4',4), ('HSK','HSK5',5), ('HSK','HSK6',6),
        ('TOPIK','TOPIK1',1), ('TOPIK','TOPIK2',2), ('TOPIK','TOPIK3',3), ('TOPIK','TOPIK4',4), ('TOPIK','TOPIK5',5), ('TOPIK','TOPIK6',6),
        ('FRAMEWORKLESS','beginner',1)
      ) AS t(framework_code, level_code, order_index)
        ON t.framework_code = l.level_framework
    `);

    // New trigger validates by language_id directly (no JOIN to languages)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION user_languages_resolve_level() RETURNS trigger AS $$
      BEGIN
        IF NEW.proficiency_level IS NULL THEN
          SELECT level_code INTO NEW.proficiency_level
          FROM framework_levels
          WHERE language_id = NEW.language_id
          ORDER BY order_index ASC
          LIMIT 1;
          IF NEW.proficiency_level IS NULL THEN
            RAISE EXCEPTION 'No framework_levels seeded for language %', NEW.language_id;
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM framework_levels
          WHERE language_id = NEW.language_id AND level_code = NEW.proficiency_level
        ) THEN
          RAISE EXCEPTION 'Invalid level % for language %', NEW.proficiency_level, NEW.language_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_user_languages_resolve_level
        BEFORE INSERT OR UPDATE OF proficiency_level ON user_languages
        FOR EACH ROW EXECUTE FUNCTION user_languages_resolve_level();
    `);

    // Now safe to drop the now-redundant column on languages
    await queryRunner.query(`ALTER TABLE languages DROP COLUMN level_framework`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore level_framework column on languages, backfill from framework_levels
    await queryRunner.query(
      `ALTER TABLE languages ADD COLUMN level_framework VARCHAR(16)`,
    );
    await queryRunner.query(`
      UPDATE languages l SET level_framework = (
        SELECT framework_code FROM framework_levels WHERE language_id = l.id LIMIT 1
      )
    `);
    await queryRunner.query(
      `ALTER TABLE languages ALTER COLUMN level_framework SET NOT NULL`,
    );

    // Drop new trigger + function + per-language table
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_user_languages_resolve_level ON user_languages`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS user_languages_resolve_level()`);
    await queryRunner.query(`DROP TABLE IF EXISTS framework_levels`);

    // Recreate the Phase-01 shared shape
    await queryRunner.query(`
      CREATE TABLE framework_levels (
        framework_code VARCHAR(16) NOT NULL,
        level_code     VARCHAR(16) NOT NULL,
        description    TEXT        NOT NULL,
        order_index    INT         NOT NULL,
        PRIMARY KEY (framework_code, level_code)
      )
    `);
    const seed: Array<[string, string, number]> = [
      ['CEFR', 'A1', 1], ['CEFR', 'A2', 2], ['CEFR', 'B1', 3],
      ['CEFR', 'B2', 4], ['CEFR', 'C1', 5], ['CEFR', 'C2', 6],
      ['JLPT', 'N5', 1], ['JLPT', 'N4', 2], ['JLPT', 'N3', 3],
      ['JLPT', 'N2', 4], ['JLPT', 'N1', 5],
      ['HSK', 'HSK1', 1], ['HSK', 'HSK2', 2], ['HSK', 'HSK3', 3],
      ['HSK', 'HSK4', 4], ['HSK', 'HSK5', 5], ['HSK', 'HSK6', 6],
      ['TOPIK', 'TOPIK1', 1], ['TOPIK', 'TOPIK2', 2], ['TOPIK', 'TOPIK3', 3],
      ['TOPIK', 'TOPIK4', 4], ['TOPIK', 'TOPIK5', 5], ['TOPIK', 'TOPIK6', 6],
      ['FRAMEWORKLESS', 'beginner', 1],
    ];
    for (const [framework, level, order] of seed) {
      await queryRunner.query(
        `INSERT INTO framework_levels (framework_code, level_code, description, order_index)
         VALUES ($1, $2, $3, $4)`,
        [framework, level, `TBD: ${framework} ${level}`, order],
      );
    }

    // Restore Phase-02 trigger that joins languages.level_framework
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
      CREATE TRIGGER trg_user_languages_resolve_level
        BEFORE INSERT OR UPDATE OF proficiency_level ON user_languages
        FOR EACH ROW EXECUTE FUNCTION user_languages_resolve_level();
    `);
  }
}
