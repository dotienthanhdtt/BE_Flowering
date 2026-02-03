-- ================================================
-- AI Language Learning Backend - Initial Schema
-- Run this in Supabase SQL Editor
-- ================================================

-- Create enum types
CREATE TYPE "proficiency_level_enum" AS ENUM ('beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced');
CREATE TYPE "lesson_difficulty_enum" AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE "exercise_type_enum" AS ENUM ('multiple_choice', 'fill_in_blank', 'listening', 'speaking', 'translation', 'matching');
CREATE TYPE "progress_status_enum" AS ENUM ('not_started', 'in_progress', 'completed');
CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'expired', 'cancelled', 'trial');
CREATE TYPE "subscription_plan_enum" AS ENUM ('free', 'monthly', 'yearly', 'lifetime');
CREATE TYPE "message_role_enum" AS ENUM ('user', 'assistant', 'system');
CREATE TYPE "device_platform_enum" AS ENUM ('ios', 'android', 'web');

-- Languages table
CREATE TABLE "languages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(10) UNIQUE NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "native_name" VARCHAR(100),
  "is_active" BOOLEAN DEFAULT true
);

-- Users table
CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(255) UNIQUE NOT NULL,
  "password_hash" VARCHAR(255),
  "auth_provider" VARCHAR(50),
  "provider_id" VARCHAR(255),
  "display_name" VARCHAR(100),
  "avatar_url" TEXT,
  "native_language_id" UUID REFERENCES "languages"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- User Languages table (junction)
CREATE TABLE "user_languages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "language_id" UUID NOT NULL REFERENCES "languages"("id") ON DELETE CASCADE,
  "proficiency_level" proficiency_level_enum DEFAULT 'beginner',
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("user_id", "language_id")
);

-- Lessons table
CREATE TABLE "lessons" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "language_id" UUID NOT NULL REFERENCES "languages"("id") ON DELETE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "difficulty" lesson_difficulty_enum DEFAULT 'beginner',
  "order_index" INTEGER DEFAULT 0,
  "is_premium" BOOLEAN DEFAULT false,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Exercises table
CREATE TABLE "exercises" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lesson_id" UUID NOT NULL REFERENCES "lessons"("id") ON DELETE CASCADE,
  "type" exercise_type_enum NOT NULL,
  "question" TEXT NOT NULL,
  "correct_answer" JSONB NOT NULL,
  "options" JSONB,
  "audio_url" TEXT,
  "order_index" INTEGER DEFAULT 0,
  "points" INTEGER DEFAULT 10,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- User Progress table
CREATE TABLE "user_progress" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lesson_id" UUID NOT NULL REFERENCES "lessons"("id") ON DELETE CASCADE,
  "status" progress_status_enum DEFAULT 'not_started',
  "score_earned" INTEGER DEFAULT 0,
  "exercises_completed" INTEGER DEFAULT 0,
  "exercises_total" INTEGER DEFAULT 0,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("user_id", "lesson_id")
);

-- User Exercise Attempts table
CREATE TABLE "user_exercise_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exercise_id" UUID NOT NULL REFERENCES "exercises"("id") ON DELETE CASCADE,
  "user_answer" JSONB NOT NULL,
  "is_correct" BOOLEAN NOT NULL,
  "points_earned" INTEGER DEFAULT 0,
  "time_spent_seconds" INTEGER,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions table
CREATE TABLE "subscriptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID UNIQUE NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan" subscription_plan_enum DEFAULT 'free',
  "status" subscription_status_enum DEFAULT 'active',
  "revenuecat_id" VARCHAR(255),
  "current_period_start" TIMESTAMPTZ,
  "current_period_end" TIMESTAMPTZ,
  "cancel_at_period_end" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- AI Conversations table
CREATE TABLE "ai_conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "language_id" UUID NOT NULL REFERENCES "languages"("id") ON DELETE CASCADE,
  "title" VARCHAR(255),
  "topic" VARCHAR(100),
  "message_count" INTEGER DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- AI Conversation Messages table
CREATE TABLE "ai_conversation_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" message_role_enum NOT NULL,
  "content" TEXT NOT NULL,
  "audio_url" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Device Tokens table
CREATE TABLE "device_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "fcm_token" TEXT UNIQUE NOT NULL,
  "platform" device_platform_enum NOT NULL,
  "device_name" VARCHAR(100),
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX "idx_users_email" ON "users"("email");
CREATE INDEX "idx_user_languages_user_id" ON "user_languages"("user_id");
CREATE INDEX "idx_lessons_language_id" ON "lessons"("language_id");
CREATE INDEX "idx_exercises_lesson_id" ON "exercises"("lesson_id");
CREATE INDEX "idx_user_progress_user_id" ON "user_progress"("user_id");
CREATE INDEX "idx_user_exercise_attempts_user_id" ON "user_exercise_attempts"("user_id");
CREATE INDEX "idx_subscriptions_user_id" ON "subscriptions"("user_id");
CREATE INDEX "idx_ai_conversations_user_id" ON "ai_conversations"("user_id");
CREATE INDEX "idx_ai_conversation_messages_conversation_id" ON "ai_conversation_messages"("conversation_id");
CREATE INDEX "idx_device_tokens_user_id" ON "device_tokens"("user_id");

-- Seed languages
INSERT INTO "languages" ("code", "name", "native_name", "is_active")
VALUES
  ('en', 'English', 'English', true),
  ('vi', 'Vietnamese', 'Tiếng Việt', true),
  ('ja', 'Japanese', '日本語', true),
  ('ko', 'Korean', '한국어', true),
  ('zh', 'Chinese', '中文', true),
  ('es', 'Spanish', 'Español', true),
  ('fr', 'French', 'Français', true),
  ('de', 'German', 'Deutsch', true),
  ('pt', 'Portuguese', 'Português', true),
  ('th', 'Thai', 'ไทย', true)
ON CONFLICT ("code") DO NOTHING;
