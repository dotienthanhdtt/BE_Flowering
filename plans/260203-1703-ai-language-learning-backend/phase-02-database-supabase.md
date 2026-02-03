# Phase 02: Database & Supabase Setup

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | complete |
| Effort | 4h |
| Dependencies | Phase 01 |

Configure Supabase PostgreSQL connection, create 5NF database schema migrations, implement database module with connection pooling, and configure Row Level Security policies.

## Key Insights

From research:
- Use Session Mode (port 5432) for persistent NestJS backend
- TypeORM integrates well with NestJS via `@nestjs/typeorm`
- RLS policies with `(SELECT auth.uid())` caching for performance
- Service role key bypasses RLS for admin operations

## Requirements

### Functional
- Supabase PostgreSQL connection via TypeORM
- All database tables created via migrations
- RLS policies for user data isolation
- Supabase Storage configured for audio files

### Non-Functional
- Connection pooling (max: 10, min: 2)
- 30s idle timeout
- SSL required for all connections

## Architecture

```
src/
└── database/
    ├── database.module.ts        # TypeORM configuration
    ├── entities/
    │   ├── user.entity.ts
    │   ├── language.entity.ts
    │   ├── user-language.entity.ts
    │   ├── lesson.entity.ts
    │   ├── exercise.entity.ts
    │   ├── user-progress.entity.ts
    │   ├── user-exercise-attempt.entity.ts
    │   ├── subscription.entity.ts
    │   ├── ai-conversation.entity.ts
    │   ├── ai-conversation-message.entity.ts
    │   └── device-token.entity.ts
    ├── migrations/
    │   └── 1706976000000-initial-schema.ts
    └── seeds/
        └── languages.seed.ts
```

## Database Schema (5NF)

```sql
-- 11 Tables Total

users                    -- Core user data
languages                -- Available languages
user_languages           -- User's learning languages (M:N)
lessons                  -- Lesson content per language
exercises                -- Exercises per lesson
user_progress            -- User's lesson progress
user_exercise_attempts   -- Individual exercise attempts
subscriptions            -- RevenueCat subscription data
ai_conversations         -- AI chat sessions
ai_conversation_messages -- Chat messages
device_tokens            -- FCM push notification tokens
```

## Related Code Files

### Files to Create
- `src/database/database.module.ts`
- `src/database/entities/user.entity.ts`
- `src/database/entities/language.entity.ts`
- `src/database/entities/user-language.entity.ts`
- `src/database/entities/lesson.entity.ts`
- `src/database/entities/exercise.entity.ts`
- `src/database/entities/user-progress.entity.ts`
- `src/database/entities/user-exercise-attempt.entity.ts`
- `src/database/entities/subscription.entity.ts`
- `src/database/entities/ai-conversation.entity.ts`
- `src/database/entities/ai-conversation-message.entity.ts`
- `src/database/entities/device-token.entity.ts`
- `src/database/migrations/1706976000000-initial-schema.ts`
- `src/database/seeds/languages.seed.ts`
- `src/services/supabase-storage.service.ts`

### Files to Modify
- `src/app.module.ts` - Import DatabaseModule

## Implementation Steps

### Step 1: Install Database Dependencies (10min)

```bash
npm install @nestjs/typeorm typeorm pg @supabase/supabase-js
```

### Step 2: Configure Database Module (30min)

```typescript
// src/database/database.module.ts
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
        extra: {
          max: 10,
          min: 2,
          idleTimeoutMillis: 30000,
        },
        autoLoadEntities: true,
        synchronize: false, // Use migrations
      }),
    }),
  ],
})
export class DatabaseModule {}
```

### Step 3: Create Entity Classes (90min)

Create all 11 entities with TypeORM decorators:

```typescript
// src/database/entities/user.entity.ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true, name: 'password_hash' })
  passwordHash?: string;

  @Column({ name: 'auth_provider', nullable: true })
  authProvider?: string;

  @Column({ name: 'provider_id', nullable: true })
  providerId?: string;

  @Column({ name: 'display_name', nullable: true })
  displayName?: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @ManyToOne(() => Language, { nullable: true })
  @JoinColumn({ name: 'native_language_id' })
  nativeLanguage?: Language;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### Step 4: Create Initial Migration (30min)

```typescript
// src/database/migrations/1706976000000-initial-schema.ts
export class InitialSchema1706976000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create all tables with proper constraints
    await queryRunner.query(`
      CREATE TABLE languages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        native_name VARCHAR(100),
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        auth_provider VARCHAR(50),
        provider_id VARCHAR(255),
        display_name VARCHAR(100),
        avatar_url TEXT,
        native_language_id UUID REFERENCES languages(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ... remaining tables
    `);
  }
}
```

### Step 5: Create RLS Policies Migration (30min)

```sql
-- Enable RLS on all user-facing tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exercise_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- User can only access own data
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING ((SELECT auth.uid()) = id);

CREATE POLICY "user_languages_select_own" ON user_languages
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ... more policies
```

### Step 6: Create Language Seed Script (20min)

```typescript
// src/database/seeds/languages.seed.ts
export const languageSeed = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
];
```

### Step 7: Configure Supabase Storage Service (30min)

```typescript
// src/services/supabase-storage.service.ts
@Injectable()
export class SupabaseStorageService {
  private supabase: SupabaseClient;

  constructor(private config: ConfigService) {
    this.supabase = createClient(
      config.get('SUPABASE_URL'),
      config.get('SUPABASE_SERVICE_KEY'),
    );
  }

  async uploadAudio(file: Buffer, userId: string, fileName: string): Promise<string> {
    const filePath = `${userId}/audio/${Date.now()}-${fileName}`;
    const { data, error } = await this.supabase.storage
      .from('audio-files')
      .upload(filePath, file, { contentType: 'audio/mpeg' });

    if (error) throw error;
    return data.path;
  }

  async getSignedUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from('audio-files')
      .createSignedUrl(filePath, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }
}
```

### Step 8: Run Migrations (10min)

```bash
npm run migration:run
npm run seed:languages
```

## Todo List

- [x] Install TypeORM and PostgreSQL dependencies
- [x] Create DatabaseModule with connection config
- [x] Create User entity
- [x] Create Language entity
- [x] Create UserLanguage entity
- [x] Create Lesson entity
- [x] Create Exercise entity
- [x] Create UserProgress entity
- [x] Create UserExerciseAttempt entity
- [x] Create Subscription entity
- [x] Create AiConversation entity
- [x] Create AiConversationMessage entity
- [x] Create DeviceToken entity
- [x] Create initial schema migration
- [x] Create RLS policies migration
- [x] Create language seed data
- [x] Configure Supabase Storage service
- [x] Run migrations on dev database
- [x] Verify all tables created correctly
- [x] Test RLS policies work as expected

## Success Criteria

- [x] All 11 tables created in Supabase
- [x] Migrations run without errors
- [x] RLS policies active on user tables
- [x] Seed data inserted (languages)
- [x] TypeORM entities match database schema
- [x] Storage service can upload/retrieve files

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration conflicts | Medium | Medium | Use timestamps, test on dev first |
| RLS blocking service role | Low | High | Test policies thoroughly |
| Connection pool exhaustion | Low | Medium | Monitor connections, tune pool size |

## Security Considerations

- Service role key only used server-side
- RLS enabled on all user-facing tables
- No direct database access from client
- Password hashes use bcrypt (in auth module)
