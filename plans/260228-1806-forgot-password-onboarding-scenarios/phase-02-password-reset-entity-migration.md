---
status: completed
---

**Parent plan:** [plan.md](./plan.md)
**Research:** [researcher-typeorm-langchain-report.md](./reports/researcher-typeorm-langchain-report.md)
**Migration reference:** `src/database/migrations/1706976000000-initial-schema.ts`

---

# Phase 02: PasswordReset Entity + Migration

**Priority:** P1 | **Status:** completed | **Est:** 0.5h
**Blocks:** Phase 03 (AuthService needs PasswordReset repository)

## Overview

Create the `PasswordReset` TypeORM entity and a timestamped migration to add the `password_resets` table to the database.

## Key Insights

- Migration format: raw SQL in `queryRunner.query()` — matches existing `1706976000000-initial-schema.ts` pattern
- UUID PKs: use `gen_random_uuid()` (PostgreSQL native, consistent with all other tables)
- Add composite index on `(email, created_at)` for rate-limit count queries
- OTP hashed with SHA-256 (hex = 64 chars), reset token also SHA-256 (64 chars)
- Migration timestamp: use `Date.now()` at time of creation (13 digits)

## Architecture

### Entity Design

```ts
@Entity('password_resets')
class PasswordReset {
  id: UUID                       // PK, gen_random_uuid()
  email: varchar(255)            // not unique — multiple requests per email allowed
  otpHash: varchar(64)           // SHA-256(6-digit OTP) hex string
  resetTokenHash: varchar(64)?   // SHA-256(UUID) hex string; null until OTP verified
  attempts: int DEFAULT 0        // OTP verification attempts
  expiresAt: timestamptz         // OTP expiry = createdAt + 10min
  resetTokenExpiresAt: timestamptz?  // Reset token expiry = verified time + 15min
  used: boolean DEFAULT false    // Reset token consumed flag
  createdAt: timestamptz         // creation time
}
```

## Related Code Files

- `src/database/entities/password-reset.entity.ts` — **create**
- `src/database/migrations/{timestamp}-create-password-resets-table.ts` — **create**
- `src/database/entities/index.ts` (if exists) — export new entity

## Implementation Steps

### Step 1: Create `password-reset.entity.ts`
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Index(['email', 'createdAt'])  // composite index for rate-limit queries
@Entity('password_resets')
export class PasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'otp_hash', type: 'varchar', length: 64 })
  otpHash: string;  // SHA-256(otp) hex

  @Column({ name: 'reset_token_hash', type: 'varchar', length: 64, nullable: true })
  resetTokenHash: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;  // OTP expiry

  @Column({ name: 'reset_token_expires_at', type: 'timestamptz', nullable: true })
  resetTokenExpiresAt: Date | null;

  @Column({ type: 'boolean', default: false })
  used: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

### Step 2: Create migration file

Filename: `{current_unix_ms}-create-password-resets-table.ts`

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResetsTable{TIMESTAMP} implements MigrationInterface {
  name = 'CreatePasswordResetsTable{TIMESTAMP}';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_resets" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL,
        "otp_hash" VARCHAR(64) NOT NULL,
        "reset_token_hash" VARCHAR(64),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "reset_token_expires_at" TIMESTAMPTZ,
        "used" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_password_resets_email_created_at"
      ON "password_resets" ("email", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_password_resets_email_created_at";`);
    await queryRunner.query(`DROP TABLE "password_resets";`);
  }
}
```

### Step 3: Register entity in DatabaseModule

Check `src/database/database.module.ts` — add `PasswordReset` to the entities array.
Also check `src/database/typeorm-data-source.ts` for CLI migrations config.

### Step 4: Verify compile
```bash
npm run build
```

## Todo List

- [ ] Create `src/database/entities/password-reset.entity.ts`
- [ ] Create migration file with current unix timestamp
- [ ] Register PasswordReset in DatabaseModule entities list
- [ ] Verify `npm run build` passes
- [ ] Note: actual `migration:run` will be done during implementation, not in plan

## Success Criteria

- Entity compiles with correct TypeORM decorators
- Migration has proper `up` and `down` methods
- Composite index `(email, created_at)` defined for rate-limit queries
- `PasswordReset` importable from database entities

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Timestamp collision | Use `Date.now()` at file creation time |
| Missing entity in DatabaseModule | Explicitly check entities array and add |
