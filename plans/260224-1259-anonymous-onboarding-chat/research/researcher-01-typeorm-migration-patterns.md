# TypeORM Migration Patterns Research

## 1. Making FK Column Nullable

**Pattern from existing code:**
```sql
-- From initial schema - current NOT NULL
ALTER TABLE "ai_conversations"
  ALTER COLUMN "user_id" DROP NOT NULL;
```

**TypeORM Migration Implementation:**
```typescript
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    ALTER TABLE "ai_conversations"
    ALTER COLUMN "user_id" DROP NOT NULL;
  `);
}

public async down(queryRunner: QueryRunner): Promise<void> {
  // Only if data guarantees user_id can be NOT NULL
  await queryRunner.query(`
    ALTER TABLE "ai_conversations"
    ALTER COLUMN "user_id" SET NOT NULL;
  `);
}
```

**Key Points:**
- Use `ALTER COLUMN ... DROP NOT NULL` for PostgreSQL
- Reverse in `down()` with `SET NOT NULL` (requires no NULL values in column)
- FK constraint itself remains, just the constraint becomes optional

---

## 2. Adding Multiple New Columns

**Pattern from refresh_tokens migration:**
```typescript
await queryRunner.query(`
  ALTER TABLE "ai_conversations"
  ADD COLUMN "session_token" VARCHAR UNIQUE,
  ADD COLUMN "type" ai_conversation_type_enum,
  ADD COLUMN "expires_at" TIMESTAMPTZ;
`);
```

**For ENUM type:**
```typescript
// First create enum type if not exists
public async up(queryRunner: QueryRunner): Promise<void> {
  // Create enum
  await queryRunner.query(`
    CREATE TYPE "ai_conversation_type_enum" AS ENUM ('anonymous', 'authenticated')
  `);

  // Add columns
  await queryRunner.query(`
    ALTER TABLE "ai_conversations"
    ADD COLUMN "session_token" VARCHAR UNIQUE,
    ADD COLUMN "type" ai_conversation_type_enum DEFAULT 'authenticated',
    ADD COLUMN "expires_at" TIMESTAMPTZ;
  `);
}

public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    ALTER TABLE "ai_conversations"
    DROP COLUMN IF EXISTS "session_token",
    DROP COLUMN IF EXISTS "type",
    DROP COLUMN IF EXISTS "expires_at";
  `);
  await queryRunner.query(`DROP TYPE IF EXISTS "ai_conversation_type_enum"`);
}
```

---

## 3. Entity Decorator Changes for Nullable Relations

**Current pattern (required FK):**
```typescript
@ManyToOne(() => User, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'user_id' })
user!: User;

@Column({ type: 'uuid', name: 'user_id' })
userId!: string;
```

**For nullable relation:**
```typescript
@ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
@JoinColumn({ name: 'user_id' })
user?: User | null;

@Column({ type: 'uuid', name: 'user_id', nullable: true })
userId?: string | null;
```

**Critical:** Must update both `@ManyToOne` and `@Column` decorators:
- Add `nullable: true` to both
- Change property type to `T | null` or optional `T?`
- Keep field name alignment: `userId` maps to `user_id` column

---

## 4. Index Creation in Migrations

**Pattern from existing migrations:**
```typescript
// From refresh_tokens migration
await queryRunner.query(`
  CREATE INDEX "IDX_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")
`);

await queryRunner.query(`
  CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")
`);
```

**For UNIQUE index (like session_token):**
```typescript
await queryRunner.query(`
  CREATE UNIQUE INDEX "IDX_ai_conversations_session_token"
  ON "ai_conversations" ("session_token")
  WHERE "session_token" IS NOT NULL
`);
```

**Index cleanup in down():**
```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_conversations_session_token"`);
}
```

**Naming Convention:** `IDX_{table}_{column(s)}`

---

## Key Recommendations

1. **Timestamp fields:** Always use `TIMESTAMPTZ` (timezone-aware) not `TIMESTAMP`
2. **Defaults:** Set defaults in migration AND entity (@Column default)
3. **Down migrations:** Must be reversible; test rollback scenarios
4. **Enums:** Create type first, then alter table in one migration
5. **Unique columns:** Nullable unique columns need partial index: `WHERE column IS NOT NULL`
6. **FK changes:** Changing FK from NOT NULL to nullable doesn't drop constraint, just nullability

---

## Summary for ai_conversations Update

Migration needed:
1. Create enum: `ai_conversation_type_enum` with values `['anonymous', 'authenticated']`
2. Alter table: Add `session_token`, `type`, `expires_at` columns
3. Alter table: Drop NOT NULL from `user_id`
4. Create index on `session_token` (unique, partial for NULLs)
5. Update entity: Add new properties, make `user` relation nullable
