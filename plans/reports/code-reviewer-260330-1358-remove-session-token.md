# Code Review: Remove sessionToken, Replace with conversationId

**Date:** 2026-03-30
**Reviewer:** code-reviewer
**Scope:** 15 source files across entity, migration, onboarding, auth, AI modules

## Overall Assessment

Clean, well-executed refactor. The migration from an opaque `sessionToken` to using the conversation UUID primary key (`conversationId`) simplifies the data model and removes a redundant column. No remaining `sessionToken` references in source code (only a harmless comment in a spec file and expected migration history).

## Critical Issues

None.

## High Priority

### H1. Security: UUID PK replaces opaque token for anonymous sessions

**Risk:** `sessionToken` was an opaque, unguessable value. Conversation `id` is a UUID v4 PK. UUID v4 is cryptographically random (122 bits of entropy), so brute-force enumeration is infeasible. However, the security posture has changed:

- **Before:** Even if someone knew the conversation `id`, they also needed the `sessionToken` to interact.
- **After:** The `id` alone is the credential for anonymous onboarding sessions.

**Assessment:** Acceptable. The old `sessionToken` was itself a UUID-like value with no additional entropy over the PK. The `@IsUUID()` validation on all DTOs ensures only well-formed UUIDs are accepted. The `findValidSession` method correctly filters by `type: AiConversationType.ANONYMOUS`, so authenticated conversations cannot be accessed via onboarding endpoints.

**Recommendation:** No action required, but document this trust model: "the conversation UUID acts as a bearer credential for anonymous sessions."

### H2. `linkOnboardingSession` correctness

```typescript
// auth.service.ts:328-329
const result = await this.conversationRepository.update(
  { id: conversationId, type: AiConversationType.ANONYMOUS },
  { userId, type: AiConversationType.AUTHENTICATED },
);
```

**Verdict:** Correct. The WHERE clause filters on both `id` and `type: ANONYMOUS`, preventing:
- Linking an already-authenticated conversation
- Linking another user's conversation (since anonymous conversations have no userId)

No TOCTOU race: the `update` is atomic. If two auth requests race with the same `conversationId`, only one will match `ANONYMOUS` and succeed; the second will get `affected === 0` (logged as warning, no error thrown). This is the right behavior.

## Medium Priority

### M1. `findValidSession` -- correct but no user scoping

```typescript
// onboarding.service.ts:169-170
const conversation = await this.conversationRepo.findOne({
  where: { id: conversationId, type: AiConversationType.ANONYMOUS },
});
```

**Verdict:** Correct for anonymous onboarding. Anonymous sessions have no `userId`, so there is no user to scope to. The `type: ANONYMOUS` filter prevents accessing authenticated conversations.

### M2. `verifyMessageOwnership` -- correct dual-path check

```typescript
// translation.service.ts:184-191
if (userId && message.conversation.userId === userId) return;
if (
  conversationId &&
  message.conversation.id === conversationId &&
  message.conversation.type === AiConversationType.ANONYMOUS
) return;
throw new ForbiddenException('You do not own this conversation');
```

**Verdict:** Correct. Two access paths:
1. Authenticated user: checked via `userId` match on conversation
2. Anonymous user: checked via `conversationId` match AND `type === ANONYMOUS`

The ANONYMOUS type check prevents an anonymous caller from accessing an authenticated user's conversation by guessing its UUID. Good.

### M3. Migration correctness

```sql
-- up
DROP INDEX IF EXISTS "IDX_ai_conversations_session_token";
ALTER TABLE "ai_conversations" DROP COLUMN IF EXISTS "session_token";

-- down
ALTER TABLE "ai_conversations" ADD COLUMN "session_token" VARCHAR(255);
CREATE UNIQUE INDEX ... WHERE "session_token" IS NOT NULL;
```

**Verdict:** Correct. `IF EXISTS` / `IF NOT EXISTS` guards make migration idempotent. The `down` migration restores the column and index but does NOT restore data (expected -- down migrations are for schema rollback, not data recovery).

**Note:** The down migration adds the column as nullable with no default, which is correct since existing rows should have NULL.

## Low Priority

### L1. Stale comment in spec file

`src/modules/onboarding/onboarding.service.spec.ts:38` has `// sessionToken removed -- lookup by id now`. This is a transitional comment that should be cleaned up eventually but is non-blocking.

### L2. Old migration still references session_token

`src/database/migrations/1740000000000-add-onboarding-to-ai-conversations.ts` still contains `session_token` references. This is expected and correct -- old migrations are historical records and must NOT be modified.

## Checklist Verification

- [x] **Remaining references:** Only in migration files (expected) and one spec comment (harmless)
- [x] **findValidSession:** Correctly uses `{ id: conversationId, type: ANONYMOUS }`
- [x] **linkOnboardingSession:** Correctly uses `{ id: conversationId, type: ANONYMOUS }` in UPDATE WHERE
- [x] **verifyMessageOwnership:** Correctly checks `message.conversation.id === conversationId` with ANONYMOUS type guard
- [x] **Security (UUID vs opaque token):** UUID v4 has sufficient entropy; no downgrade
- [x] **Migration:** Correct up/down, idempotent, index dropped before column
- [x] **DTO validation:** All `conversationId` fields have `@IsUUID()` decorator
- [x] **Backwards compatibility:** Breaking change for API consumers (field rename), but this is intentional

## Positive Observations

- All DTOs consistently use `@IsUUID()` for `conversationId` -- input validation at the boundary
- `linkOnboardingSession` is best-effort (catches errors, logs warning) -- prevents auth flow from failing due to onboarding linking issues
- `verifyMessageOwnership` has proper dual-path auth check with ANONYMOUS type guard
- Migration uses `IF EXISTS` guards for idempotency
- Clean separation: onboarding endpoints are `@Public()`, authenticated AI endpoints require JWT

## Recommended Actions

1. **Non-blocking:** Remove transitional comment in spec file
2. **Non-blocking:** Consider documenting the trust model for anonymous session UUIDs in API docs

## Unresolved Questions

None.

---
**Status:** DONE
**Summary:** Clean refactor with correct security boundaries. No blocking issues found.
