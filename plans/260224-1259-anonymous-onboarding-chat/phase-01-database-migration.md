# Phase 01: Database Migration

## Context Links
- [Parent Plan](./plan.md)
- [Brainstorm](../reports/brainstorm-260224-1238-anonymous-onboarding-chat.md)
- [TypeORM Research](./research/researcher-01-typeorm-migration-patterns.md)
- [Entity](../../src/database/entities/ai-conversation.entity.ts)
- [Existing Migration Pattern](../../src/database/migrations/1738678500000-create-refresh-tokens-table.ts)

## Overview
- **Priority:** P1 (blocks all other phases)
- **Status:** complete
- **Effort:** 1h
- **Description:** Alter `ai_conversations` table to support anonymous onboarding sessions. Make `user_id` nullable, add `session_token`, `type`, `expires_at` columns with indexes.

## Key Insights
- Existing queries all filter by `user_id`, so making it nullable won't break them
- Use PostgreSQL ENUM for `type` column (values: `anonymous`, `authenticated`)
- `session_token` needs partial unique index (WHERE NOT NULL) since most rows will have NULL
- Existing migration naming: `{timestamp}-{description}.ts` with class name matching

## Requirements

### Functional
- `user_id` column becomes nullable (FK constraint stays, just optional)
- New `session_token` VARCHAR column, unique when not null
- New `type` ENUM column with default `'authenticated'`
- New `expires_at` TIMESTAMPTZ column, nullable

### Non-Functional
- Migration must be reversible (proper `down()`)
- No data loss on existing rows
- Indexes for query performance

## Architecture

```
ai_conversations table (after migration):
  id              UUID PK
  user_id         UUID FK -> users(id) [NOW NULLABLE]
  language_id     UUID FK -> languages(id)
  session_token   VARCHAR UNIQUE [NEW]
  type            ENUM('anonymous','authenticated') DEFAULT 'authenticated' [NEW]
  expires_at      TIMESTAMPTZ [NEW]
  title           VARCHAR(255)
  topic           VARCHAR(100)
  message_count   INT DEFAULT 0
  metadata        JSONB
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
```

## Related Code Files

### Files to Create
- `src/database/migrations/{timestamp}-add-onboarding-to-ai-conversations.ts`

### Files to Modify
- `src/database/entities/ai-conversation.entity.ts`

## Implementation Steps

### Step 1: Create Migration File

File: `src/database/migrations/1740000000000-add-onboarding-to-ai-conversations.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingToAiConversations1740000000000
  implements MigrationInterface
{
  name = 'AddOnboardingToAiConversations1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create enum type
    await queryRunner.query(`
      CREATE TYPE "ai_conversation_type_enum"
      AS ENUM ('anonymous', 'authenticated')
    `);

    // 2. Make user_id nullable
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "user_id" DROP NOT NULL
    `);

    // 3. Add new columns
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ADD COLUMN "session_token" VARCHAR(255),
      ADD COLUMN "type" "ai_conversation_type_enum"
        DEFAULT 'authenticated' NOT NULL,
      ADD COLUMN "expires_at" TIMESTAMPTZ
    `);

    // 4. Create partial unique index on session_token
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ai_conversations_session_token"
      ON "ai_conversations" ("session_token")
      WHERE "session_token" IS NOT NULL
    `);

    // 5. Create index on type for filtering
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_conversations_type"
      ON "ai_conversations" ("type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_session_token"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      DROP COLUMN IF EXISTS "expires_at",
      DROP COLUMN IF EXISTS "type",
      DROP COLUMN IF EXISTS "session_token"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "ai_conversation_type_enum"
    `);
    // Only safe if no NULL user_id rows exist
    await queryRunner.query(`
      DELETE FROM "ai_conversations"
      WHERE "user_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ALTER COLUMN "user_id" SET NOT NULL
    `);
  }
}
```

### Step 2: Update AiConversation Entity

Update `src/database/entities/ai-conversation.entity.ts`:

```typescript
// Add enum above entity class
export enum AiConversationType {
  ANONYMOUS = 'anonymous',
  AUTHENTICATED = 'authenticated',
}

// Modify existing fields:
@ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
@JoinColumn({ name: 'user_id' })
user?: User | null;

@Column({ type: 'uuid', name: 'user_id', nullable: true })
userId?: string | null;

// Add new fields:
@Column({ type: 'varchar', length: 255, name: 'session_token', nullable: true, unique: true })
sessionToken?: string | null;

@Column({
  type: 'enum',
  enum: AiConversationType,
  default: AiConversationType.AUTHENTICATED,
})
type!: AiConversationType;

@Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
expiresAt?: Date | null;
```

### Step 3: Verify Migration

```bash
npm run migration:run
# Verify: SELECT column_name, is_nullable FROM information_schema.columns
#   WHERE table_name = 'ai_conversations';
```

## Todo List
- [ ] Create migration file with proper timestamp
- [ ] Add `AiConversationType` enum to entity
- [ ] Make `userId` / `user` nullable in entity
- [ ] Add `sessionToken`, `type`, `expiresAt` to entity
- [ ] Run migration locally
- [ ] Verify existing authenticated chat still works
- [ ] Run `npm run build` to confirm compilation

## Success Criteria
- Migration runs without errors
- `user_id` is nullable in DB
- New columns exist with correct types/defaults
- Existing rows have `type = 'authenticated'` and `session_token = NULL`
- Existing AI chat features unaffected (queries filter by userId)
- `npm run build` passes

## Risk Assessment
- **Low:** Nullable FK is standard PostgreSQL pattern
- **Low:** Default `'authenticated'` means existing rows auto-populate
- **Medium:** `down()` migration deletes anonymous rows before restoring NOT NULL -- acceptable for dev/staging, document for production

## Security Considerations
- No security impact; schema change only
- RLS policies may need update if they reference `user_id IS NOT NULL`

## Next Steps
- Phase 02: Module Setup (depends on this phase for entity types)
