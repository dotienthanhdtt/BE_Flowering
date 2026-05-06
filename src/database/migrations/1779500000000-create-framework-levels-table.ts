import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFrameworkLevelsTable1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS framework_levels (
        framework_code VARCHAR(16) NOT NULL,
        level_code     VARCHAR(16) NOT NULL,
        description    TEXT        NOT NULL,
        order_index    INT         NOT NULL,
        PRIMARY KEY (framework_code, level_code)
      )
    `);

    const seed: Array<[string, string, number]> = [
      // CEFR
      ['CEFR', 'A1', 1],
      ['CEFR', 'A2', 2],
      ['CEFR', 'B1', 3],
      ['CEFR', 'B2', 4],
      ['CEFR', 'C1', 5],
      ['CEFR', 'C2', 6],
      // JLPT (N5 lowest → N1 highest)
      ['JLPT', 'N5', 1],
      ['JLPT', 'N4', 2],
      ['JLPT', 'N3', 3],
      ['JLPT', 'N2', 4],
      ['JLPT', 'N1', 5],
      // HSK
      ['HSK', 'HSK1', 1],
      ['HSK', 'HSK2', 2],
      ['HSK', 'HSK3', 3],
      ['HSK', 'HSK4', 4],
      ['HSK', 'HSK5', 5],
      ['HSK', 'HSK6', 6],
      // TOPIK
      ['TOPIK', 'TOPIK1', 1],
      ['TOPIK', 'TOPIK2', 2],
      ['TOPIK', 'TOPIK3', 3],
      ['TOPIK', 'TOPIK4', 4],
      ['TOPIK', 'TOPIK5', 5],
      ['TOPIK', 'TOPIK6', 6],
      // FRAMEWORKLESS
      ['FRAMEWORKLESS', 'beginner', 1],
    ];

    for (const [framework, level, order] of seed) {
      await queryRunner.query(
        `INSERT INTO framework_levels (framework_code, level_code, description, order_index)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (framework_code, level_code) DO NOTHING`,
        [framework, level, `TBD: ${framework} ${level}`, order],
      );
    }

    // Backfill languages.level_framework for vi/th and any other NULL rows
    await queryRunner.query(
      `UPDATE languages SET level_framework = 'FRAMEWORKLESS' WHERE level_framework IS NULL`,
    );

    // Normalize any existing user_languages rows that point at FRAMEWORKLESS langs but
    // hold a non-FRAMEWORKLESS level (e.g., legacy 'A1' default) to 'beginner' so the
    // upcoming trigger validation doesn't reject future updates on those rows.
    await queryRunner.query(`
      UPDATE user_languages ul
      SET proficiency_level = 'beginner'
      FROM languages l
      WHERE ul.language_id = l.id
        AND l.level_framework = 'FRAMEWORKLESS'
        AND ul.proficiency_level <> 'beginner'
    `);

    await queryRunner.query(`ALTER TABLE languages ALTER COLUMN level_framework SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE languages ALTER COLUMN level_framework DROP NOT NULL`);
    // Restore NULL for langs we backfilled to FRAMEWORKLESS (best-effort: only those
    // that had no framework before — vi, th)
    await queryRunner.query(
      `UPDATE languages SET level_framework = NULL WHERE code IN ('vi','th') AND level_framework = 'FRAMEWORKLESS'`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS framework_levels`);
  }
}
