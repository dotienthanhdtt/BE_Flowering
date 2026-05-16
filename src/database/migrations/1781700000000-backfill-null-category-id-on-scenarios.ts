import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6: backfill any remaining NULL category_id to the for_you category
 * of the scenario's language. Covers legacy personal + any KOL rows admin
 * left without a category. Fails loudly if any row remains unresolved.
 */
export class BackfillNullCategoryIdOnScenarios1781700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Audit: log counts before backfill
    const preCheck: { type: string; null_count: string }[] = await queryRunner.query(`
      SELECT type, COUNT(*) AS null_count
        FROM scenarios
       WHERE category_id IS NULL
       GROUP BY type
    `);
    if (preCheck.length > 0) {
      console.log('BackfillNullCategoryId pre-check:', JSON.stringify(preCheck));
    }

    // Backfill all NULL category_id rows to for_you of their language
    await queryRunner.query(`
      UPDATE scenarios s
         SET category_id = c.id
        FROM scenario_categories c
       WHERE c.language_id = s.language_id
         AND c.slug = 'for_you'
         AND s.category_id IS NULL
    `);

    // Post-check: fail if any remain
    const postCheck: { count: string }[] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM scenarios WHERE category_id IS NULL
    `);
    const remaining = parseInt(postCheck[0]?.count ?? '0', 10);
    if (remaining > 0) {
      throw new Error(
        `BackfillNullCategoryId: ${remaining} scenario(s) still have NULL category_id after backfill. ` +
          `Check for scenarios with language_id not matching any active language with a for_you category.`,
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op: original NULL values are unrecoverable after backfill.
    // To restore NULL category_ids, manually identify affected rows before running up().
  }
}
