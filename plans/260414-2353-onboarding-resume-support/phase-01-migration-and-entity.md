# Phase 01 — Migration + Entity Columns

## Context Links

- Entity: `src/database/entities/ai-conversation.entity.ts`
- Prior migration pattern: `src/database/migrations/1740000000000-add-onboarding-to-ai-conversations.ts`
- Plan: `plan.md`

## Overview

- Priority: P1
- Status: pending
- Adds two nullable JSONB columns to `ai_conversations` for caching onboarding `/complete` output.

## Key Insights

- Columns on `ai_conversations` preferred over new table — simpler, 1:1 relationship, no join overhead.
- Nullable columns — existing rows compute lazily on next `/complete` call. No backfill.
- JSONB (not JSON) — indexable if future querying needed; matches existing `metadata` column pattern.

## Requirements

**Functional:**
- Add `extracted_profile JSONB NULL` column.
- Add `scenarios JSONB NULL` column.
- `down()` drops both columns cleanly.

**Non-functional:**
- Zero downtime — adds are instant for nullable columns w/o default.
- No RLS policy change (`ai_conversations` already covered by existing anonymous policy).

## Architecture

```
ai_conversations (existing)
  + extracted_profile JSONB NULL   ← new
  + scenarios         JSONB NULL   ← new
```

Entity adds two TS properties mapped via `@Column({ name: '...', type: 'jsonb', nullable: true })`.

## Related Code Files

**Create:**
- `src/database/migrations/1776100000000-add-onboarding-cache-to-ai-conversations.ts`

**Modify:**
- `src/database/entities/ai-conversation.entity.ts` (add `extractedProfile`, `scenarios` properties)

**Delete:** none

## Implementation Steps

1. Create migration file. Pattern:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingCacheToAiConversations1776100000000 implements MigrationInterface {
  name = 'AddOnboardingCacheToAiConversations1776100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      ADD COLUMN "extracted_profile" JSONB NULL,
      ADD COLUMN "scenarios" JSONB NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_conversations"
      DROP COLUMN IF EXISTS "scenarios",
      DROP COLUMN IF EXISTS "extracted_profile"
    `);
  }
}
```

2. Update `src/database/entities/ai-conversation.entity.ts` — add after `metadata` column:

```ts
@Column({ type: 'jsonb', name: 'extracted_profile', nullable: true })
extractedProfile?: Record<string, unknown> | null;

@Column({ type: 'jsonb', nullable: true })
scenarios?: Array<Record<string, unknown>> | null;
```

3. Run `npm run build` → ensure no TS errors.

4. Run `npm run migration:run` → verify migration applies (and confirm in psql: `\d ai_conversations`).

5. Test rollback: `npm run migration:revert` → columns gone. Re-apply for next phase.

## Todo List

- [ ] Create migration file with timestamp `1776100000000`
- [ ] Update `ai-conversation.entity.ts` with 2 new `@Column` decorators
- [ ] `npm run build` passes
- [ ] `npm run migration:run` applies cleanly in dev DB
- [ ] Verify columns via psql
- [ ] `npm run migration:revert` rolls back cleanly
- [ ] Re-run migration for next phase

## Success Criteria

- `ai_conversations` table has `extracted_profile JSONB` and `scenarios JSONB` nullable columns.
- Entity TS properties accessible: `conversation.extractedProfile`, `conversation.scenarios`.
- Build + migration up/down succeeds.

## Risk Assessment

- **Risk:** Migration timestamp collision with in-flight plans. **Mitigation:** Use `1776100000000` (after latest `1776000000000`).
- **Risk:** JSONB column adds lock table on large tables. **Mitigation:** `ai_conversations` is small; nullable adds are near-instant in PG 11+.

## Security Considerations

- No sensitive fields added — data is already available to users via `/complete` call.
- No RLS change: existing policy covers all columns.

## Next Steps

Phase 02 uses these columns for idempotent caching in `OnboardingService.complete()`.
