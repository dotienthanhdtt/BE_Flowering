import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1: language-scoped scenario_categories
 *
 * - Drops scenarios_type_owner_check (personal scenarios will now have category_id)
 * - Adds slug + language_id to scenario_categories
 * - Clones global rows per active learning language
 * - Backfills scenarios.category_id to language-matched clones
 * - Removes global (language_id IS NULL) rows
 * - Enforces UNIQUE(language_id, slug)
 */
export class AddLanguageIdAndSlugToScenarioCategories1781400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old type/owner/category_id CHECK so personal scenarios can carry category_id
    await queryRunner.query(
      `ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_type_owner_check`,
    );

    // 2. Add columns (nullable first for backfill)
    await queryRunner.query(
      `ALTER TABLE scenario_categories ADD COLUMN IF NOT EXISTS slug VARCHAR(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE scenario_categories ADD COLUMN IF NOT EXISTS language_id UUID REFERENCES languages(id)`,
    );

    // 3. Backfill slug from name: lower-snake, strip non-alphanumeric
    await queryRunner.query(`
      UPDATE scenario_categories
         SET slug = lower(regexp_replace(
                      regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'),
                      '_$', '', 'g'
                    ))
       WHERE slug IS NULL
    `);

    // 4. Clone each global category row once per active learning language
    await queryRunner.query(`
      INSERT INTO scenario_categories (id, name, slug, language_id, order_index, is_active, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        c.name,
        lower(regexp_replace(
          regexp_replace(trim(c.name), '[^a-zA-Z0-9]+', '_', 'g'),
          '_$', '', 'g'
        )),
        l.id,
        c.order_index,
        c.is_active,
        now(),
        now()
      FROM scenario_categories c
      CROSS JOIN languages l
      WHERE c.language_id IS NULL
        AND l.is_learning_available = true
    `);

    // 5. Backfill scenarios.category_id to language-matched clones
    // Note: Postgres UPDATE...FROM does not allow referencing the target table (s)
    // inside a JOIN ON clause — the join is evaluated before correlation with target.
    // Hence s.language_id must live in the outer WHERE.
    await queryRunner.query(`
      UPDATE scenarios s
         SET category_id = new_cat.id
        FROM scenario_categories old_cat
        JOIN scenario_categories new_cat
          ON new_cat.slug = old_cat.slug
       WHERE s.category_id = old_cat.id
         AND old_cat.language_id IS NULL
         AND new_cat.language_id = s.language_id
    `);

    // 6. Delete old global rows
    await queryRunner.query(`DELETE FROM scenario_categories WHERE language_id IS NULL`);

    // 7. Set NOT NULL
    await queryRunner.query(
      `ALTER TABLE scenario_categories ALTER COLUMN language_id SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE scenario_categories ALTER COLUMN slug SET NOT NULL`);

    // 8. Unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_scenario_category_lang_slug
        ON scenario_categories(language_id, slug)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uniq_scenario_category_lang_slug`);
    await queryRunner.query(`ALTER TABLE scenario_categories ALTER COLUMN slug DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE scenario_categories ALTER COLUMN language_id DROP NOT NULL`,
    );
    // Re-add global rows from one language's clones (best-effort; data loss accepted in down)
    await queryRunner.query(`
      INSERT INTO scenario_categories (id, name, slug, order_index, is_active, created_at, updated_at)
      SELECT gen_random_uuid(), name, slug, order_index, is_active, now(), now()
      FROM scenario_categories
      WHERE language_id = (SELECT id FROM languages WHERE is_learning_available = true ORDER BY name LIMIT 1)
    `);
    await queryRunner.query(`DELETE FROM scenario_categories WHERE language_id IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE scenario_categories DROP COLUMN IF EXISTS language_id`);
    await queryRunner.query(`ALTER TABLE scenario_categories DROP COLUMN IF EXISTS slug`);
    // Restore CHECK constraint
    await queryRunner.query(`
      ALTER TABLE scenarios ADD CONSTRAINT scenarios_type_owner_check CHECK (
        (type = 'personal' AND owner_id IS NOT NULL AND category_id IS NULL)
        OR
        (type IN ('system','kol') AND owner_id IS NULL AND category_id IS NOT NULL)
      )
    `);
  }
}
