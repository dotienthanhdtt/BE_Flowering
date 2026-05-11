--
-- PostgreSQL database dump
--

\restrict svvHqVx04fwPPvzTxoBLZreJQpbZARwqveW6oq8PbdxpHoUCHmnbWrhregLfvgm

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: access_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.access_tier AS ENUM (
    'free',
    'premium',
    'premium_plus'
);


--
-- Name: ai_conversation_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_conversation_type_enum AS ENUM (
    'anonymous',
    'authenticated',
    'personalize_intake'
);


--
-- Name: content_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_status AS ENUM (
    'draft',
    'published',
    'archived'
);


--
-- Name: device_platform_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.device_platform_enum AS ENUM (
    'ios',
    'android',
    'web'
);


--
-- Name: exercise_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exercise_type_enum AS ENUM (
    'multiple_choice',
    'fill_in_blank',
    'listening',
    'speaking',
    'translation',
    'matching'
);


--
-- Name: lesson_difficulty_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lesson_difficulty_enum AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


--
-- Name: message_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_role_enum AS ENUM (
    'user',
    'assistant',
    'system'
);


--
-- Name: progress_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.progress_status_enum AS ENUM (
    'not_started',
    'in_progress',
    'completed'
);


--
-- Name: scenario_chat_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scenario_chat_status_enum AS ENUM (
    'CHATTING',
    'DONE'
);


--
-- Name: scenario_difficulty; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scenario_difficulty AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


--
-- Name: scenario_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scenario_type AS ENUM (
    'system',
    'kol',
    'personal'
);


--
-- Name: subscription_plan_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_plan_enum AS ENUM (
    'free',
    'monthly',
    'yearly',
    'lifetime'
);


--
-- Name: subscription_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status_enum AS ENUM (
    'active',
    'expired',
    'cancelled',
    'trial'
);


--
-- Name: user_languages_resolve_level(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_languages_resolve_level() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.proficiency_level IS NULL THEN
          SELECT level_code INTO NEW.proficiency_level
          FROM framework_levels
          WHERE language_id = NEW.language_id
          ORDER BY order_index ASC
          LIMIT 1;
          IF NEW.proficiency_level IS NULL THEN
            RAISE EXCEPTION 'No framework_levels seeded for language %', NEW.language_id;
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM framework_levels
          WHERE language_id = NEW.language_id AND level_code = NEW.proficiency_level
        ) THEN
          RAISE EXCEPTION 'Invalid level % for language %', NEW.proficiency_level, NEW.language_id;
        END IF;
        RETURN NEW;
      END;
      $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_conversation_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversation_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role public.message_role_enum NOT NULL,
    content text NOT NULL,
    audio_url text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    translated_content text,
    translated_lang character varying(10)
);


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    language_id uuid NOT NULL,
    title character varying(255),
    topic character varying(100),
    message_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    type public.ai_conversation_type_enum DEFAULT 'authenticated'::public.ai_conversation_type_enum NOT NULL,
    expires_at timestamp with time zone,
    scenario_id uuid,
    extracted_profile jsonb,
    scenarios jsonb,
    injected_vocab_ids uuid[],
    status public.scenario_chat_status_enum DEFAULT 'CHATTING'::public.scenario_chat_status_enum NOT NULL,
    max_turns integer DEFAULT 12 NOT NULL,
    native_language character varying(10)
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    fcm_token text NOT NULL,
    platform public.device_platform_enum NOT NULL,
    device_name character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exercises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id uuid NOT NULL,
    type public.exercise_type_enum NOT NULL,
    question text NOT NULL,
    correct_answer jsonb NOT NULL,
    options jsonb,
    audio_url text,
    order_index integer DEFAULT 0,
    points integer DEFAULT 10,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    language_id uuid NOT NULL,
    status public.content_status DEFAULT 'published'::public.content_status NOT NULL
);


--
-- Name: framework_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_levels (
    language_id uuid NOT NULL,
    framework_code character varying(16) NOT NULL,
    level_code character varying(16) NOT NULL,
    description text NOT NULL,
    order_index integer NOT NULL
);


--
-- Name: kol_bundle_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kol_bundle_scenarios (
    bundle_id uuid NOT NULL,
    scenario_id uuid NOT NULL
);


--
-- Name: kol_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kol_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gift_code character varying(50) NOT NULL,
    creator_id uuid,
    title character varying(255) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: languages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.languages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    native_name character varying(100),
    is_active boolean DEFAULT true,
    flag_url text,
    is_native_available boolean DEFAULT true NOT NULL,
    is_learning_available boolean DEFAULT true NOT NULL
);


--
-- Name: lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    language_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    difficulty public.lesson_difficulty_enum DEFAULT 'beginner'::public.lesson_difficulty_enum,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    status public.content_status DEFAULT 'published'::public.content_status NOT NULL,
    access_tier public.access_tier DEFAULT 'free'::public.access_tier NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    otp_hash character varying(64) NOT NULL,
    reset_token_hash character varying(64),
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    reset_token_expires_at timestamp with time zone,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    token_hash character varying(255) NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scenario_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenario_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid,
    language_id uuid NOT NULL,
    creator_id uuid,
    title character varying(255) NOT NULL,
    description text,
    image_url text,
    difficulty public.scenario_difficulty DEFAULT 'beginner'::public.scenario_difficulty NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.content_status DEFAULT 'published'::public.content_status NOT NULL,
    access_tier public.access_tier DEFAULT 'free'::public.access_tier NOT NULL,
    type public.scenario_type DEFAULT 'system'::public.scenario_type NOT NULL,
    owner_id uuid,
    triggers_personalization boolean DEFAULT false NOT NULL,
    CONSTRAINT scenarios_type_owner_check CHECK ((((type = 'personal'::public.scenario_type) AND (owner_id IS NOT NULL) AND (category_id IS NULL)) OR ((type = ANY (ARRAY['system'::public.scenario_type, 'kol'::public.scenario_type])) AND (owner_id IS NULL) AND (category_id IS NOT NULL))))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan public.subscription_plan_enum DEFAULT 'free'::public.subscription_plan_enum,
    status public.subscription_status_enum DEFAULT 'active'::public.subscription_status_enum,
    app_user_id character varying(255),
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    event_timestamp_ms bigint,
    auto_resume_at timestamp with time zone
);


--
-- Name: user_exercise_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_exercise_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    user_answer jsonb NOT NULL,
    is_correct boolean NOT NULL,
    points_earned integer DEFAULT 0,
    time_spent_seconds integer,
    created_at timestamp with time zone DEFAULT now(),
    language_id uuid NOT NULL
);


--
-- Name: user_languages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_languages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    language_id uuid NOT NULL,
    proficiency_level character varying(16),
    last_learned boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    status public.progress_status_enum DEFAULT 'not_started'::public.progress_status_enum,
    score_earned integer DEFAULT 0,
    exercises_completed integer DEFAULT 0,
    exercises_total integer DEFAULT 0,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    language_id uuid NOT NULL
);


--
-- Name: user_scenario_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_scenario_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    scenario_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    auth_provider character varying(50),
    provider_id character varying(255),
    display_name character varying(100),
    avatar_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    google_provider_id character varying(255),
    apple_provider_id character varying(255),
    firebase_uid character varying(128),
    email_verified boolean DEFAULT false NOT NULL,
    phone_number character varying(20),
    roles text[] DEFAULT ARRAY['user'::text] NOT NULL,
    native_language character varying(10),
    personalized_trial_used_at timestamp with time zone,
    last_personalization_at timestamp with time zone,
    personalization_profile_snapshot jsonb
);


--
-- Name: vocabulary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    word character varying(255) NOT NULL,
    translation character varying(255) NOT NULL,
    source_lang character varying(10) NOT NULL,
    target_lang character varying(10) NOT NULL,
    part_of_speech character varying(50),
    pronunciation character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    definition text,
    examples jsonb,
    box smallint DEFAULT 1 NOT NULL,
    due_at timestamp with time zone DEFAULT now() NOT NULL,
    last_reviewed_at timestamp with time zone,
    review_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT vocabulary_box_check CHECK (((box >= 1) AND (box <= 5)))
);


--
-- Name: vocabulary_injection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_injection_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    vocabulary_id uuid NOT NULL,
    turn_index smallint NOT NULL,
    was_used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    event_id character varying(255) NOT NULL,
    event_type character varying(50) NOT NULL,
    processed_at timestamp with time zone DEFAULT now()
);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY (id);


--
-- Name: refresh_tokens PK_refresh_tokens; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "PK_refresh_tokens" PRIMARY KEY (id);


--
-- Name: vocabulary PK_vocabulary; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT "PK_vocabulary" PRIMARY KEY (id);


--
-- Name: vocabulary UQ_vocabulary_user_word_langs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT "UQ_vocabulary_user_word_langs" UNIQUE (user_id, word, source_lang, target_lang);


--
-- Name: ai_conversation_messages ai_conversation_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_messages
    ADD CONSTRAINT ai_conversation_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_fcm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_fcm_token_key UNIQUE (fcm_token);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (id);


--
-- Name: framework_levels framework_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_levels
    ADD CONSTRAINT framework_levels_pkey PRIMARY KEY (language_id, level_code);


--
-- Name: kol_bundle_scenarios kol_bundle_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundle_scenarios
    ADD CONSTRAINT kol_bundle_scenarios_pkey PRIMARY KEY (bundle_id, scenario_id);


--
-- Name: kol_bundle_scenarios kol_bundle_scenarios_scenario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundle_scenarios
    ADD CONSTRAINT kol_bundle_scenarios_scenario_id_key UNIQUE (scenario_id);


--
-- Name: kol_bundles kol_bundles_gift_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundles
    ADD CONSTRAINT kol_bundles_gift_code_key UNIQUE (gift_code);


--
-- Name: kol_bundles kol_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundles
    ADD CONSTRAINT kol_bundles_pkey PRIMARY KEY (id);


--
-- Name: languages languages_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.languages
    ADD CONSTRAINT languages_code_key UNIQUE (code);


--
-- Name: languages languages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.languages
    ADD CONSTRAINT languages_pkey PRIMARY KEY (id);


--
-- Name: lessons lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: scenario_categories scenario_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_categories
    ADD CONSTRAINT scenario_categories_pkey PRIMARY KEY (id);


--
-- Name: scenarios scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: user_exercise_attempts user_exercise_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exercise_attempts
    ADD CONSTRAINT user_exercise_attempts_pkey PRIMARY KEY (id);


--
-- Name: user_languages user_languages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_languages
    ADD CONSTRAINT user_languages_pkey PRIMARY KEY (id);


--
-- Name: user_languages user_languages_user_id_language_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_languages
    ADD CONSTRAINT user_languages_user_id_language_id_key UNIQUE (user_id, language_id);


--
-- Name: user_progress user_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT user_progress_pkey PRIMARY KEY (id);


--
-- Name: user_progress user_progress_user_id_lesson_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT user_progress_user_id_lesson_id_key UNIQUE (user_id, lesson_id);


--
-- Name: user_scenario_access user_scenario_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scenario_access
    ADD CONSTRAINT user_scenario_access_pkey PRIMARY KEY (id);


--
-- Name: user_scenario_access user_scenario_access_user_id_scenario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scenario_access
    ADD CONSTRAINT user_scenario_access_user_id_scenario_id_key UNIQUE (user_id, scenario_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_firebase_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vocabulary_injection_events vocabulary_injection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_injection_events
    ADD CONSTRAINT vocabulary_injection_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: IDX_ai_conversations_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_ai_conversations_type" ON public.ai_conversations USING btree (type);


--
-- Name: IDX_password_resets_email_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_password_resets_email_created_at" ON public.password_resets USING btree (email, created_at);


--
-- Name: IDX_refresh_tokens_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_refresh_tokens_token_hash" ON public.refresh_tokens USING btree (token_hash);


--
-- Name: IDX_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_refresh_tokens_user_id" ON public.refresh_tokens USING btree (user_id);


--
-- Name: IDX_users_apple_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_users_apple_provider_id" ON public.users USING btree (apple_provider_id) WHERE (apple_provider_id IS NOT NULL);


--
-- Name: IDX_users_google_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_users_google_provider_id" ON public.users USING btree (google_provider_id) WHERE (google_provider_id IS NOT NULL);


--
-- Name: IDX_vocabulary_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_vocabulary_user_id" ON public.vocabulary USING btree (user_id);


--
-- Name: UQ_ai_conversations_user_scenario_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UQ_ai_conversations_user_scenario_active" ON public.ai_conversations USING btree (user_id, scenario_id) WHERE ((scenario_id IS NOT NULL) AND (status <> 'DONE'::public.scenario_chat_status_enum));


--
-- Name: idx_ai_conversation_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversation_messages_conversation_id ON public.ai_conversation_messages USING btree (conversation_id);


--
-- Name: idx_ai_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_user_id ON public.ai_conversations USING btree (user_id);


--
-- Name: idx_ai_conversations_user_scenario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_user_scenario ON public.ai_conversations USING btree (user_id, scenario_id) WHERE (scenario_id IS NOT NULL);


--
-- Name: idx_device_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_tokens_user_id ON public.device_tokens USING btree (user_id);


--
-- Name: idx_exercises_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_language ON public.exercises USING btree (language_id);


--
-- Name: idx_exercises_lesson_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_lesson_id ON public.exercises USING btree (lesson_id);


--
-- Name: idx_exercises_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_status ON public.exercises USING btree (status);


--
-- Name: idx_framework_levels_framework; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_framework_levels_framework ON public.framework_levels USING btree (framework_code);


--
-- Name: idx_kol_bundles_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kol_bundles_creator ON public.kol_bundles USING btree (creator_id);


--
-- Name: idx_lessons_access_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_access_tier ON public.lessons USING btree (access_tier);


--
-- Name: idx_lessons_language_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_language_id ON public.lessons USING btree (language_id);


--
-- Name: idx_lessons_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_status ON public.lessons USING btree (status);


--
-- Name: idx_scenarios_access_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_access_tier ON public.scenarios USING btree (access_tier);


--
-- Name: idx_scenarios_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_category ON public.scenarios USING btree (category_id);


--
-- Name: idx_scenarios_difficulty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_difficulty ON public.scenarios USING btree (difficulty);


--
-- Name: idx_scenarios_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_language ON public.scenarios USING btree (language_id);


--
-- Name: idx_scenarios_owner_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_owner_lang ON public.scenarios USING btree (owner_id, language_id) WHERE (type = 'personal'::public.scenario_type);


--
-- Name: idx_scenarios_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_status ON public.scenarios USING btree (status);


--
-- Name: idx_scenarios_triggers_personalization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scenarios_triggers_personalization ON public.scenarios USING btree (id) WHERE (triggers_personalization = true);


--
-- Name: idx_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);


--
-- Name: idx_user_exercise_attempts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_exercise_attempts_user_id ON public.user_exercise_attempts USING btree (user_id);


--
-- Name: idx_user_exercise_attempts_user_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_exercise_attempts_user_lang ON public.user_exercise_attempts USING btree (user_id, language_id, created_at DESC);


--
-- Name: idx_user_languages_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_languages_user_id ON public.user_languages USING btree (user_id);


--
-- Name: idx_user_progress_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_progress_user_id ON public.user_progress USING btree (user_id);


--
-- Name: idx_user_progress_user_lang_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_progress_user_lang_status ON public.user_progress USING btree (user_id, language_id, status);


--
-- Name: idx_user_scenario_access_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_scenario_access_user ON public.user_scenario_access USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_vocab_inj_events_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocab_inj_events_conv ON public.vocabulary_injection_events USING btree (conversation_id);


--
-- Name: idx_vocab_inj_events_vocab; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocab_inj_events_vocab ON public.vocabulary_injection_events USING btree (vocabulary_id);


--
-- Name: idx_vocab_user_lang_due_box; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocab_user_lang_due_box ON public.vocabulary USING btree (user_id, target_lang, due_at, box);


--
-- Name: idx_vocab_user_lang_last_reviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocab_user_lang_last_reviewed ON public.vocabulary USING btree (user_id, target_lang, last_reviewed_at);


--
-- Name: idx_vocabulary_user_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vocabulary_user_due ON public.vocabulary USING btree (user_id, due_at);


--
-- Name: user_languages trg_user_languages_resolve_level; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_languages_resolve_level BEFORE INSERT OR UPDATE OF proficiency_level ON public.user_languages FOR EACH ROW EXECUTE FUNCTION public.user_languages_resolve_level();


--
-- Name: refresh_tokens FK_refresh_tokens_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vocabulary FK_vocabulary_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary
    ADD CONSTRAINT "FK_vocabulary_user" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_conversation_messages ai_conversation_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_messages
    ADD CONSTRAINT ai_conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE SET NULL;


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: exercises exercises_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE CASCADE;


--
-- Name: ai_conversations fk_ai_conversations_language; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT fk_ai_conversations_language FOREIGN KEY (language_id) REFERENCES public.languages(id);


--
-- Name: exercises fk_exercises_language; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT fk_exercises_language FOREIGN KEY (language_id) REFERENCES public.languages(id);


--
-- Name: scenarios fk_scenarios_language; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT fk_scenarios_language FOREIGN KEY (language_id) REFERENCES public.languages(id);


--
-- Name: user_exercise_attempts fk_user_exercise_attempts_language; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exercise_attempts
    ADD CONSTRAINT fk_user_exercise_attempts_language FOREIGN KEY (language_id) REFERENCES public.languages(id);


--
-- Name: user_progress fk_user_progress_language; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT fk_user_progress_language FOREIGN KEY (language_id) REFERENCES public.languages(id);


--
-- Name: framework_levels framework_levels_language_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_levels
    ADD CONSTRAINT framework_levels_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.languages(id) ON DELETE CASCADE;


--
-- Name: kol_bundle_scenarios kol_bundle_scenarios_bundle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundle_scenarios
    ADD CONSTRAINT kol_bundle_scenarios_bundle_id_fkey FOREIGN KEY (bundle_id) REFERENCES public.kol_bundles(id) ON DELETE CASCADE;


--
-- Name: kol_bundle_scenarios kol_bundle_scenarios_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundle_scenarios
    ADD CONSTRAINT kol_bundle_scenarios_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE;


--
-- Name: kol_bundles kol_bundles_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kol_bundles
    ADD CONSTRAINT kol_bundles_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lessons lessons_language_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.languages(id) ON DELETE CASCADE;


--
-- Name: scenarios scenarios_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.scenario_categories(id) ON DELETE CASCADE;


--
-- Name: scenarios scenarios_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scenarios scenarios_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_exercise_attempts user_exercise_attempts_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exercise_attempts
    ADD CONSTRAINT user_exercise_attempts_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE CASCADE;


--
-- Name: user_exercise_attempts user_exercise_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_exercise_attempts
    ADD CONSTRAINT user_exercise_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_languages user_languages_language_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_languages
    ADD CONSTRAINT user_languages_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.languages(id) ON DELETE CASCADE;


--
-- Name: user_languages user_languages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_languages
    ADD CONSTRAINT user_languages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_progress user_progress_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT user_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE CASCADE;


--
-- Name: user_progress user_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT user_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_scenario_access user_scenario_access_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scenario_access
    ADD CONSTRAINT user_scenario_access_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE RESTRICT;


--
-- Name: user_scenario_access user_scenario_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scenario_access
    ADD CONSTRAINT user_scenario_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vocabulary_injection_events vocabulary_injection_events_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_injection_events
    ADD CONSTRAINT vocabulary_injection_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;


--
-- Name: vocabulary_injection_events vocabulary_injection_events_vocabulary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_injection_events
    ADD CONSTRAINT vocabulary_injection_events_vocabulary_id_fkey FOREIGN KEY (vocabulary_id) REFERENCES public.vocabulary(id) ON DELETE CASCADE;


--
-- Name: ai_conversation_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversation_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: exercises; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

--
-- Name: kol_bundle_scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kol_bundle_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: kol_bundles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kol_bundles ENABLE ROW LEVEL SECURITY;

--
-- Name: languages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;

--
-- Name: lessons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: password_resets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: scenario_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scenario_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_exercise_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_exercise_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_languages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_languages ENABLE ROW LEVEL SECURITY;

--
-- Name: user_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: user_scenario_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_scenario_access ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vocabulary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;

--
-- Name: vocabulary_injection_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vocabulary_injection_events ENABLE ROW LEVEL SECURITY;

--
-- Name: vocabulary vocabulary_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vocabulary_user_isolation ON public.vocabulary USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

