import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Translate scenario_categories.name per language.
 *
 * After 1781400000000 cloned categories per language, the `name` column kept the
 * English source on every language clone. This migration sets a localized name
 * for each (language_code, slug) pair. Matching is by (languages.code, slug) so
 * the migration is idempotent and tolerant of missing/extra rows.
 */
export class TranslateScenarioCategoryNames1781410000000 implements MigrationInterface {
  // [slug, lang_code, localized_name]
  private readonly translations: Array<[string, string, string]> = [
    // daily_life
    ['daily_life', 'en', 'Daily Life'],
    ['daily_life', 'es', 'Vida diaria'],
    ['daily_life', 'fr', 'Vie quotidienne'],
    ['daily_life', 'de', 'Alltag'],
    ['daily_life', 'pt', 'Vida diária'],
    ['daily_life', 'zh', '日常生活'],
    ['daily_life', 'ja', '日常生活'],
    ['daily_life', 'ko', '일상생활'],
    // travel_transportation
    ['travel_transportation', 'en', 'Travel & Transportation'],
    ['travel_transportation', 'es', 'Viajes y transporte'],
    ['travel_transportation', 'fr', 'Voyage et transport'],
    ['travel_transportation', 'de', 'Reisen & Transport'],
    ['travel_transportation', 'pt', 'Viagem e transporte'],
    ['travel_transportation', 'zh', '旅行与交通'],
    ['travel_transportation', 'ja', '旅行と交通'],
    ['travel_transportation', 'ko', '여행과 교통'],
    // food_dining
    ['food_dining', 'en', 'Food & Dining'],
    ['food_dining', 'es', 'Comida y restaurantes'],
    ['food_dining', 'fr', 'Nourriture et restauration'],
    ['food_dining', 'de', 'Essen & Gastronomie'],
    ['food_dining', 'pt', 'Comida e restaurantes'],
    ['food_dining', 'zh', '饮食与餐厅'],
    ['food_dining', 'ja', '食事とレストラン'],
    ['food_dining', 'ko', '음식과 식당'],
    // business_work
    ['business_work', 'en', 'Business & Work'],
    ['business_work', 'es', 'Negocios y trabajo'],
    ['business_work', 'fr', 'Affaires et travail'],
    ['business_work', 'de', 'Geschäft & Arbeit'],
    ['business_work', 'pt', 'Negócios e trabalho'],
    ['business_work', 'zh', '商务与工作'],
    ['business_work', 'ja', 'ビジネスと仕事'],
    ['business_work', 'ko', '비즈니스와 업무'],
    // shopping
    ['shopping', 'en', 'Shopping'],
    ['shopping', 'es', 'Compras'],
    ['shopping', 'fr', 'Achats'],
    ['shopping', 'de', 'Einkaufen'],
    ['shopping', 'pt', 'Compras'],
    ['shopping', 'zh', '购物'],
    ['shopping', 'ja', 'ショッピング'],
    ['shopping', 'ko', '쇼핑'],
    // healthcare
    ['healthcare', 'en', 'Healthcare'],
    ['healthcare', 'es', 'Salud'],
    ['healthcare', 'fr', 'Santé'],
    ['healthcare', 'de', 'Gesundheit'],
    ['healthcare', 'pt', 'Saúde'],
    ['healthcare', 'zh', '医疗保健'],
    ['healthcare', 'ja', '医療'],
    ['healthcare', 'ko', '의료'],
    // social_hobbies
    ['social_hobbies', 'en', 'Social & Hobbies'],
    ['social_hobbies', 'es', 'Social y aficiones'],
    ['social_hobbies', 'fr', 'Social et loisirs'],
    ['social_hobbies', 'de', 'Soziales & Hobbys'],
    ['social_hobbies', 'pt', 'Social e hobbies'],
    ['social_hobbies', 'zh', '社交与爱好'],
    ['social_hobbies', 'ja', '社交と趣味'],
    ['social_hobbies', 'ko', '사교와 취미'],
    // for_you — fill the pt gap left by the seed migration
    ['for_you', 'pt', 'Para você'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, code, name] of this.translations) {
      await queryRunner.query(
        `UPDATE scenario_categories sc
            SET name = $3
           FROM languages l
          WHERE sc.language_id = l.id
            AND l.code = $2
            AND sc.slug = $1`,
        [slug, code, name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort revert: restore the original English source name on every clone
    // for the slugs we touched. Idempotent; pt for_you reverts to "For you".
    const slugToEnglish: Record<string, string> = {
      daily_life: 'Daily Life',
      travel_transportation: 'Travel & Transportation',
      food_dining: 'Food & Dining',
      business_work: 'Business & Work',
      shopping: 'Shopping',
      healthcare: 'Healthcare',
      social_hobbies: 'Social & Hobbies',
      for_you: 'For you',
    };
    for (const [slug, name] of Object.entries(slugToEnglish)) {
      await queryRunner.query(
        `UPDATE scenario_categories SET name = $2 WHERE slug = $1`,
        [slug, name],
      );
    }
  }
}
