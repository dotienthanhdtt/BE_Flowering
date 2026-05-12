import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the Supabase-specific RLS policies (they referenced `auth.uid()`,
 * which only exists on Supabase). Auth is enforced in the application layer
 * via the global JWT guard, and the app connects to Postgres with a role that
 * bypasses RLS anyway — so these policies were inert. On a Railway restore the
 * original `CREATE POLICY` statements fail and are skipped; this migration is
 * the idempotent cleanup so `migration:run` is green and future fresh setups
 * don't trip on `auth.uid()`.
 */
export class DropSupabaseRls1781000000000 implements MigrationInterface {
  name = 'DropSupabaseRls1781000000000';

  private readonly policiesByTable: Record<string, string[]> = {
    users: ['users_select_own', 'users_update_own'],
    user_languages: [
      'user_languages_select_own',
      'user_languages_insert_own',
      'user_languages_update_own',
      'user_languages_delete_own',
    ],
    user_progress: [
      'user_progress_select_own',
      'user_progress_insert_own',
      'user_progress_update_own',
    ],
    user_exercise_attempts: [
      'user_exercise_attempts_select_own',
      'user_exercise_attempts_insert_own',
    ],
    subscriptions: ['subscriptions_select_own'],
    ai_conversations: [
      'ai_conversations_select_own',
      'ai_conversations_insert_own',
      'ai_conversations_update_own',
      'ai_conversations_delete_own',
    ],
    ai_conversation_messages: [
      'ai_conversation_messages_select_own',
      'ai_conversation_messages_insert_own',
    ],
    device_tokens: [
      'device_tokens_select_own',
      'device_tokens_insert_own',
      'device_tokens_update_own',
      'device_tokens_delete_own',
    ],
    vocabulary: ['vocabulary_user_isolation'],
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, policies] of Object.entries(this.policiesByTable)) {
      for (const policy of policies) {
        await queryRunner.query(`DROP POLICY IF EXISTS "${policy}" ON "${table}";`);
      }
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
  }

  public async down(): Promise<void> {
    // No-op: the original policies depended on Supabase's `auth.uid()` and are
    // intentionally not restored. Authorization lives in the application layer.
  }
}
