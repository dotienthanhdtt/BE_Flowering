import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds `triggers_personalization = true` on flagship scenarios — one per category.
 * Completing these surfaces a personalization offer to the user.
 *
 * Selection: the introductory free/beginner scenario in each category, since
 * those are the natural first-completion milestones where users have shown
 * enough intent to warrant a personalized follow-up.
 *
 * Idempotent: matched by scenario id — re-running is a no-op.
 */
const TRIGGER_SCENARIO_IDS = [
  '65093b77-1552-4274-98cf-6859d4503ee1', // Daily Life — Morning Routine
  'd03ac577-14a1-443b-8a3e-9ddfe351d440', // Travel & Transportation — At the Airport
  '87e89d9f-d926-4e0a-958d-3bd2bd9aebbe', // Food & Dining — Ordering at a Restaurant
  'e2151688-2da1-4e76-a9c8-033a41101bbb', // Business & Work — Job Interview
  '9d984248-7cb4-4442-8a1c-729dcc0df594', // Shopping — Shopping at a Market
  '27ef1725-b376-4d3b-bcdb-9ba4f7d84221', // Healthcare — Doctor Appointment
  '15f2521c-3bb3-49ca-8a81-1ffb017a46e4', // Social & Hobbies — Meeting New People
];

export class SeedTriggersPersonalizationScenarios1780200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scenarios SET triggers_personalization = TRUE WHERE id = ANY($1::uuid[])`,
      [TRIGGER_SCENARIO_IDS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scenarios SET triggers_personalization = FALSE WHERE id = ANY($1::uuid[])`,
      [TRIGGER_SCENARIO_IDS],
    );
  }
}