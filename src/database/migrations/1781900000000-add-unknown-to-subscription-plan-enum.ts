import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PostgreSQL requires enum value additions to run outside a transaction block.
 * This migration MUST remain in its own file with `transaction = false`.
 * Do not merge this into another migration that consumes the new value in the same TX.
 */
export class AddUnknownToSubscriptionPlanEnum1781900000000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS is not supported for ALTER TYPE … ADD VALUE in older PG versions,
    // but PG 9.6+ supports it. Railway uses PG 15+, so this is safe.
    await queryRunner.query(`ALTER TYPE subscription_plan_enum ADD VALUE IF NOT EXISTS 'unknown'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Enum values cannot be removed in PostgreSQL without recreating the type.
    // Log a warning — ops must handle manually if rollback is needed.
    console.warn(
      'AddUnknownToSubscriptionPlanEnum: DOWN migration is a no-op. ' +
        'Removing enum values requires recreating the type manually. ' +
        'See runbooks/iap-unknown-sku.md for triage steps.',
    );
  }
}
