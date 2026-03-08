# Phase 01: Database Migration

## Context Links
- [Plan overview](plan.md)
- [Brainstorm](../reports/brainstorm-260224-1322-auth-improvements-onboarding-linking.md)
- [User entity](../../src/database/entities/user.entity.ts)
- [RefreshToken entity](../../src/database/entities/refresh-token.entity.ts)
- [Migration pattern](../../src/database/migrations/1740000000000-add-onboarding-to-ai-conversations.ts)

## Overview
- **Priority:** CRITICAL (blocks all other phases)
- **Status:** completed
- **Description:** Single migration covering all schema changes: token_id column, provider columns, data migration, token revocation

## Key Insights
- RefreshToken entity uses auto-generated UUID `id` as PK — we'll repurpose `id` as the tokenId lookup field (already indexed as PK)
- No need for separate `token_id` column — the existing `id` PK serves as the O(1) lookup key
- User entity has `authProvider` + `providerId` — need new `google_provider_id` and `apple_provider_id`
- Must migrate existing provider data to new columns before code changes depend on them
- Force-revoking all refresh tokens is a clean-break approach — no dual-format handling

## Requirements
### Functional
- Add `google_provider_id` (varchar 255, nullable, unique) to `users` table
- Add `apple_provider_id` (varchar 255, nullable, unique) to `users` table
- Migrate existing `providerId` data based on `authProvider` value
- Revoke all existing refresh tokens (set `revoked = true`)

### Non-functional
- Migration must be idempotent
- Down migration must restore previous state
- No data loss during migration

## Architecture
Single TypeORM migration file. Uses raw SQL for:
1. ALTER TABLE for new columns
2. UPDATE for data migration
3. UPDATE for token revocation

## Related Code Files
- **Create:** `src/database/migrations/1740100000000-auth-improvements-provider-columns.ts`
- **Modify:** `src/database/entities/user.entity.ts` (add provider columns)
- **Modify:** `src/database/entities/refresh-token.entity.ts` (add tokenId column - optional, may use existing PK)

## Implementation Steps

1. Create migration file `1740100000000-auth-improvements-provider-columns.ts`
2. In `up()`:
   a. Add `google_provider_id` VARCHAR(255) NULLABLE to `users`
   b. Add `apple_provider_id` VARCHAR(255) NULLABLE to `users`
   c. Create UNIQUE indexes on both new columns
   d. Migrate existing data: `UPDATE users SET google_provider_id = provider_id WHERE auth_provider = 'google'`
   e. Migrate existing data: `UPDATE users SET apple_provider_id = provider_id WHERE auth_provider = 'apple'`
   f. Revoke all existing refresh tokens: `UPDATE refresh_tokens SET revoked = true`
3. In `down()`:
   a. Remove unique indexes
   b. Drop `google_provider_id` and `apple_provider_id` columns
   c. (Cannot un-revoke tokens — acceptable for down migration)
4. Update `User` entity with new columns
5. Run `npm run build` to verify compilation

## Todo List
- [x] Create migration file
- [x] Add `google_provider_id` column
- [x] Add `apple_provider_id` column
- [x] Add unique indexes on new columns
- [x] Migrate existing provider data
- [x] Revoke all refresh tokens
- [x] Write `down()` migration
- [x] Update User entity with new columns
- [x] Verify build compiles

## Success Criteria
- Migration runs without errors
- Existing google/apple users have provider IDs in new columns
- All refresh tokens are revoked
- Down migration cleanly reverses schema changes
- Build compiles successfully

## Risk Assessment
- **Data migration correctness:** Test with sample data to verify provider_id moves correctly
- **Unique constraint violation:** If duplicate provider_ids exist, migration will fail — check data first

## Security Considerations
- Force logout protects users from token theft using old format
- Unique constraints prevent duplicate OAuth accounts

## Next Steps
- Phase 02 depends on this migration being complete
- Phases 03-04 depend on new User entity columns
