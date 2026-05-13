import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioEvaluations1781200000000 implements MigrationInterface {
  name = 'CreateScenarioEvaluations1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scenario_evaluations" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL UNIQUE REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
        "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "scenario_id"     uuid NOT NULL REFERENCES "scenarios"("id") ON DELETE CASCADE,
        "overall_score"   smallint,
        "fluency_score"   smallint,
        "accuracy_score"  smallint,
        "vocab_score"     smallint,
        "strengths"       text[] NOT NULL DEFAULT '{}',
        "improvements"    text[] NOT NULL DEFAULT '{}',
        "summary"         text,
        "vocab_usage"     jsonb,
        "model_used"      varchar(64),
        "prompt_version"  smallint NOT NULL DEFAULT 1,
        "error_count"     smallint NOT NULL DEFAULT 0,
        "last_error_code" varchar(32),
        "created_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_scenario_eval_user_created" ON "scenario_evaluations" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_eval_scenario" ON "scenario_evaluations" ("scenario_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "ai_conversations" ADD COLUMN "completed_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "completed_at"`,
    );
    // Rename instead of DROP to preserve paid LLM-generated evaluation data on rollback
    const timestamp = Date.now();
    await queryRunner.query(
      `ALTER TABLE "scenario_evaluations" RENAME TO "scenario_evaluations_archived_${timestamp}"`,
    );
  }
}
