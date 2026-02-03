import { MigrationInterface, QueryRunner } from 'typeorm';

export class RlsPolicies1706976100000 implements MigrationInterface {
  name = 'RlsPolicies1706976100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable RLS on user-facing tables
    await queryRunner.query(`
      ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "user_languages" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "user_progress" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "user_exercise_attempts" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "ai_conversation_messages" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;
    `);

    // Users policies - users can only access their own data
    await queryRunner.query(`
      CREATE POLICY "users_select_own" ON "users"
        FOR SELECT USING ((SELECT auth.uid()) = id);
      CREATE POLICY "users_update_own" ON "users"
        FOR UPDATE USING ((SELECT auth.uid()) = id);
    `);

    // User Languages policies
    await queryRunner.query(`
      CREATE POLICY "user_languages_select_own" ON "user_languages"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_languages_insert_own" ON "user_languages"
        FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_languages_update_own" ON "user_languages"
        FOR UPDATE USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_languages_delete_own" ON "user_languages"
        FOR DELETE USING ((SELECT auth.uid()) = user_id);
    `);

    // User Progress policies
    await queryRunner.query(`
      CREATE POLICY "user_progress_select_own" ON "user_progress"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_progress_insert_own" ON "user_progress"
        FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_progress_update_own" ON "user_progress"
        FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    `);

    // User Exercise Attempts policies
    await queryRunner.query(`
      CREATE POLICY "user_exercise_attempts_select_own" ON "user_exercise_attempts"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "user_exercise_attempts_insert_own" ON "user_exercise_attempts"
        FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
    `);

    // Subscriptions policies
    await queryRunner.query(`
      CREATE POLICY "subscriptions_select_own" ON "subscriptions"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
    `);

    // AI Conversations policies
    await queryRunner.query(`
      CREATE POLICY "ai_conversations_select_own" ON "ai_conversations"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "ai_conversations_insert_own" ON "ai_conversations"
        FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
      CREATE POLICY "ai_conversations_update_own" ON "ai_conversations"
        FOR UPDATE USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "ai_conversations_delete_own" ON "ai_conversations"
        FOR DELETE USING ((SELECT auth.uid()) = user_id);
    `);

    // AI Conversation Messages policies (check via conversation ownership)
    await queryRunner.query(`
      CREATE POLICY "ai_conversation_messages_select_own" ON "ai_conversation_messages"
        FOR SELECT USING (
          conversation_id IN (
            SELECT id FROM "ai_conversations" WHERE user_id = (SELECT auth.uid())
          )
        );
      CREATE POLICY "ai_conversation_messages_insert_own" ON "ai_conversation_messages"
        FOR INSERT WITH CHECK (
          conversation_id IN (
            SELECT id FROM "ai_conversations" WHERE user_id = (SELECT auth.uid())
          )
        );
    `);

    // Device Tokens policies
    await queryRunner.query(`
      CREATE POLICY "device_tokens_select_own" ON "device_tokens"
        FOR SELECT USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "device_tokens_insert_own" ON "device_tokens"
        FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
      CREATE POLICY "device_tokens_update_own" ON "device_tokens"
        FOR UPDATE USING ((SELECT auth.uid()) = user_id);
      CREATE POLICY "device_tokens_delete_own" ON "device_tokens"
        FOR DELETE USING ((SELECT auth.uid()) = user_id);
    `);

    // Public tables - anyone can read (no RLS needed for languages, lessons, exercises)
    // These are content tables that should be publicly readable
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all policies
    const tables = [
      'device_tokens',
      'ai_conversation_messages',
      'ai_conversations',
      'subscriptions',
      'user_exercise_attempts',
      'user_progress',
      'user_languages',
      'users',
    ];

    for (const table of tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_select_own" ON "${table}";`);
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_insert_own" ON "${table}";`);
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_update_own" ON "${table}";`);
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_delete_own" ON "${table}";`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
  }
}
