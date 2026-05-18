import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2: seed one for_you category per active learning language,
 * then install a BEFORE INSERT OR UPDATE trigger that auto-fills
 * scenarios.category_id = for_you when NULL is supplied.
 */
export class SeedForYouAndDefaultCategoryTrigger1781500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Seed one for_you row per active learning language (idempotent)
    await queryRunner.query(`
      INSERT INTO scenario_categories (id, name, slug, language_id, order_index, is_active, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        CASE l.code
          WHEN 'en' THEN 'For you'
          WHEN 'es' THEN 'Para ti'
          WHEN 'vi' THEN 'Dành cho bạn'
          WHEN 'fr' THEN 'Pour vous'
          WHEN 'de' THEN 'Für dich'
          WHEN 'ja' THEN 'あなたへ'
          WHEN 'ko' THEN '당신을 위한'
          WHEN 'zh' THEN '为你推荐'
          ELSE 'For you'
        END,
        'for_you',
        l.id,
        999,
        true,
        now(),
        now()
      FROM languages l
      WHERE l.is_learning_available = true
        AND NOT EXISTS (
          SELECT 1 FROM scenario_categories c
           WHERE c.language_id = l.id AND c.slug = 'for_you'
        )
    `);

    // 2. Trigger function: fill category_id with for_you when NULL
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION scenarios_default_category()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.category_id IS NULL THEN
          -- No is_active filter: for_you must never be deactivated; filtering on it
          -- would silently break all scenario inserts for that language.
          SELECT id INTO NEW.category_id
            FROM scenario_categories
           WHERE language_id = NEW.language_id
             AND slug = 'for_you'
           LIMIT 1;
          IF NEW.category_id IS NULL THEN
            RAISE EXCEPTION 'No for_you category exists for language_id=%', NEW.language_id;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 3. Attach trigger
    await queryRunner.query(`
      CREATE TRIGGER trg_scenarios_default_category
      BEFORE INSERT OR UPDATE OF category_id ON scenarios
      FOR EACH ROW EXECUTE FUNCTION scenarios_default_category()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_scenarios_default_category ON scenarios`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS scenarios_default_category()`);
    await queryRunner.query(`DELETE FROM scenario_categories WHERE slug = 'for_you'`);
  }
}
