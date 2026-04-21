import { MigrationInterface, QueryRunner } from 'typeorm';

// down() is best-effort for admin rollback only — C2/HSK5/TOPIK5 levels are unmappable back to 5-tier generic.
export class LanguageSpecificLevels1778000500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add level_framework to languages
    await queryRunner.query(`
      ALTER TABLE languages
        ADD COLUMN IF NOT EXISTS level_framework VARCHAR(16)
    `);

    // 2. Backfill per language code
    await queryRunner.query(
      `UPDATE languages SET level_framework = 'CEFR'  WHERE code IN ('en','es','fr','de','pt')`,
    );
    await queryRunner.query(`UPDATE languages SET level_framework = 'JLPT'  WHERE code = 'ja'`);
    await queryRunner.query(`UPDATE languages SET level_framework = 'HSK'   WHERE code = 'zh'`);
    await queryRunner.query(`UPDATE languages SET level_framework = 'TOPIK' WHERE code = 'ko'`);

    // 3. Loosen proficiency_level column type (cast enum → text)
    await queryRunner.query(`
      ALTER TABLE user_languages
        ALTER COLUMN proficiency_level TYPE VARCHAR(16)
        USING proficiency_level::text
    `);

    // 4. Drop the old enum type
    await queryRunner.query(`DROP TYPE IF EXISTS proficiency_level_enum`);

    // 5. Backfill user rows to framework-native levels
    await queryRunner.query(`
      UPDATE user_languages ul
      SET proficiency_level = CASE
        WHEN l.level_framework = 'CEFR' THEN (CASE ul.proficiency_level
          WHEN 'beginner'          THEN 'A1'
          WHEN 'elementary'        THEN 'A2'
          WHEN 'intermediate'      THEN 'B1'
          WHEN 'upper_intermediate' THEN 'B2'
          WHEN 'advanced'          THEN 'C1'
          ELSE ul.proficiency_level END)
        WHEN l.level_framework = 'JLPT' THEN (CASE ul.proficiency_level
          WHEN 'beginner'          THEN 'N5'
          WHEN 'elementary'        THEN 'N4'
          WHEN 'intermediate'      THEN 'N3'
          WHEN 'upper_intermediate' THEN 'N2'
          WHEN 'advanced'          THEN 'N1'
          ELSE ul.proficiency_level END)
        WHEN l.level_framework = 'HSK' THEN (CASE ul.proficiency_level
          WHEN 'beginner'          THEN 'HSK1'
          WHEN 'elementary'        THEN 'HSK2'
          WHEN 'intermediate'      THEN 'HSK3'
          WHEN 'upper_intermediate' THEN 'HSK4'
          WHEN 'advanced'          THEN 'HSK6'
          ELSE ul.proficiency_level END)
        WHEN l.level_framework = 'TOPIK' THEN (CASE ul.proficiency_level
          WHEN 'beginner'          THEN 'TOPIK1'
          WHEN 'elementary'        THEN 'TOPIK2'
          WHEN 'intermediate'      THEN 'TOPIK3'
          WHEN 'upper_intermediate' THEN 'TOPIK4'
          WHEN 'advanced'          THEN 'TOPIK6'
          ELSE ul.proficiency_level END)
        ELSE ul.proficiency_level
      END
      FROM languages l
      WHERE ul.language_id = l.id
        AND l.level_framework IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Inverse-map framework-native → generic (best-effort; C2/HSK5/TOPIK5 fall back to 'advanced')
    await queryRunner.query(`
      UPDATE user_languages ul
      SET proficiency_level = CASE
        WHEN l.level_framework = 'CEFR' THEN (CASE ul.proficiency_level
          WHEN 'A1' THEN 'beginner' WHEN 'A2' THEN 'elementary'
          WHEN 'B1' THEN 'intermediate' WHEN 'B2' THEN 'upper_intermediate'
          WHEN 'C1' THEN 'advanced' WHEN 'C2' THEN 'advanced'
          ELSE 'beginner' END)
        WHEN l.level_framework = 'JLPT' THEN (CASE ul.proficiency_level
          WHEN 'N5' THEN 'beginner' WHEN 'N4' THEN 'elementary'
          WHEN 'N3' THEN 'intermediate' WHEN 'N2' THEN 'upper_intermediate'
          WHEN 'N1' THEN 'advanced'
          ELSE 'beginner' END)
        WHEN l.level_framework = 'HSK' THEN (CASE ul.proficiency_level
          WHEN 'HSK1' THEN 'beginner' WHEN 'HSK2' THEN 'elementary'
          WHEN 'HSK3' THEN 'intermediate' WHEN 'HSK4' THEN 'upper_intermediate'
          WHEN 'HSK5' THEN 'advanced' WHEN 'HSK6' THEN 'advanced'
          ELSE 'beginner' END)
        WHEN l.level_framework = 'TOPIK' THEN (CASE ul.proficiency_level
          WHEN 'TOPIK1' THEN 'beginner' WHEN 'TOPIK2' THEN 'elementary'
          WHEN 'TOPIK3' THEN 'intermediate' WHEN 'TOPIK4' THEN 'upper_intermediate'
          WHEN 'TOPIK5' THEN 'advanced' WHEN 'TOPIK6' THEN 'advanced'
          ELSE 'beginner' END)
        ELSE ul.proficiency_level
      END
      FROM languages l
      WHERE ul.language_id = l.id
    `);

    // 2. Recreate the enum and restore column type
    await queryRunner.query(`
      CREATE TYPE proficiency_level_enum AS ENUM (
        'beginner','elementary','intermediate','upper_intermediate','advanced'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE user_languages
        ALTER COLUMN proficiency_level TYPE proficiency_level_enum
        USING proficiency_level::proficiency_level_enum
    `);

    // 3. Drop level_framework column
    await queryRunner.query(`ALTER TABLE languages DROP COLUMN IF EXISTS level_framework`);
  }
}
