---
type: code-review
date: 2026-04-07
slug: lesson-module
---

# Code Review: Lesson Module

## Scope
- Files: 11 (3 entities, 1 migration, 2 DTOs, 1 service, 1 controller, 1 module, 2 registrations)
- LOC: ~350
- Focus: new lesson/scenario module for home screen

## Overall Assessment

Solid implementation following existing NestJS patterns. Entity registrations done correctly in both `database.module.ts` and `lesson.module.ts`. DTOs have proper validation. A few issues need attention before production.

---

## Critical Issues

### 1. Subscription status not checked -- expired subscriptions treated as premium

**File:** `src/modules/lesson/lesson.service.ts:53-54`

```typescript
const isFreeUser = !subscription || subscription.plan === SubscriptionPlan.FREE;
```

This ignores `SubscriptionStatus`. A user with `plan: MONTHLY` but `status: EXPIRED` or `status: CANCELLED` is treated as a paid user and gets access to premium scenarios. Must also check subscription status:

```typescript
const isFreeUser =
  !subscription ||
  subscription.plan === SubscriptionPlan.FREE ||
  subscription.status === SubscriptionStatus.EXPIRED ||
  subscription.status === SubscriptionStatus.CANCELLED;
```

**Impact:** Premium content leaks to expired/cancelled subscribers.

---

## High Priority

### 2. Pagination count is wrong -- total counts before category join, results come after join

**File:** `src/modules/lesson/lesson.service.ts:40-49`

`getCount()` is called at line 40 **before** the `leftJoinAndSelect('scenario.category', ...)` is added at line 44. While this doesn't change the row count (it's a LEFT JOIN on a FK that always exists), the real problem is that `skip/take` applies to flat scenario rows, but the response groups them into categories. The `total` represents scenario count, but the client receives a `categories` array. A page of 20 scenarios might yield 3 categories with uneven distribution. The API contract is ambiguous -- document whether `total` means total scenarios or total categories.

**Impact:** Client pagination logic confusion. Not a data bug, but an API contract issue.

### 3. Subquery parameter scoping -- potential query failure

**File:** `src/modules/lesson/lesson.service.ts:74-93`

The `accessSubQuery` is built from a **different** QueryBuilder (`this.accessRepo.createQueryBuilder`), then its raw SQL is concatenated into the main query builder's WHERE clause via `getQuery()`. TypeORM does not automatically merge parameters across query builders. The `:userId` parameter in the subquery must be set on the **main** query builder, which it is (passed in the `andWhere` params object), but `getQuery()` returns the raw string with `:userId` still as a named placeholder. This works because TypeORM replaces named params in the final SQL, but it is fragile:

- If the subquery ever adds its own `.setParameter()` calls, they will be lost.
- The pattern breaks TypeORM's parameter isolation.

**Recommended:** Use TypeORM's proper subquery API:

```typescript
qb.andWhere(
  'scenario.language_id IS NULL OR scenario.language_id = :languageId OR scenario.id IN ' +
    qb.subQuery()
      .select('access.scenario_id')
      .from(UserScenarioAccess, 'access')
      .where('access.user_id = :userId')
      .getQuery(),
  { languageId, userId },
);
```

Using `qb.subQuery()` ensures parameter scoping stays within the same query builder.

### 4. Missing index for search queries

**File:** `src/database/migrations/1775500000000-create-scenarios-tables.ts`

The `search` parameter uses `ILIKE` on `scenarios.title` but no index supports this. For small datasets this is fine, but as scenarios grow, this becomes a sequential scan. Consider adding a trigram index:

```sql
CREATE INDEX idx_scenarios_title_trgm ON scenarios USING gin (title gin_trgm_ops);
```

Requires `pg_trgm` extension (usually enabled on Supabase). Not blocking, but flag for when dataset exceeds ~1000 rows.

---

## Medium Priority

### 5. No error handling in `getLessons` -- unhandled DB errors propagate as 500

**File:** `src/modules/lesson/lesson.service.ts:25`

The `getLessons` method has no try-catch. While `AllExceptionsFilter` catches at the global level, specific DB errors (connection timeout, query cancel) would return generic 500s. Existing modules in this codebase follow the same pattern, so this is consistent -- but worth noting.

### 6. `search` parameter length not bounded

**File:** `src/modules/lesson/dto/get-lessons-query.dto.ts:20-22`

`@IsString()` allows arbitrarily long search strings. Add `@MaxLength(100)` to prevent abuse (long ILIKE patterns are expensive):

```typescript
@IsOptional()
@IsString()
@MaxLength(100)
search?: string;
```

### 7. `ScenarioStatus.LEARNED` defined but never assigned

**File:** `src/modules/lesson/dto/lesson-response.dto.ts:8`

The `LEARNED` status exists in the enum but `computeStatus()` never returns it. This is likely intended for future use (progress tracking), but it means the client might code against a status that is never sent. Either add a comment marking it as reserved, or remove until the progress feature is built (YAGNI).

### 8. Migration timestamp far in the future

**File:** `src/database/migrations/1775500000000-create-scenarios-tables.ts`

Timestamp `1775500000000` is year 2026, which is fine for ordering, but verify it sorts after the latest existing migration to avoid TypeORM skipping it.

---

## Low Priority

### 9. `category` relation could be null if data is inconsistent

**File:** `src/modules/lesson/lesson.service.ts:106-107`

`scenario.category` is accessed without null check. The FK has `ON DELETE CASCADE`, so orphaned scenarios shouldn't exist, but a `leftJoinAndSelect` could theoretically return null. Since the DB constraint enforces this, risk is minimal.

### 10. Path alias not used in lesson module imports

**File:** `src/modules/lesson/lesson.module.ts:5-8`

Uses relative paths `../../database/entities/...` instead of `@/database/entities/...`. Other modules may vary, but the project configures `@/*` path aliases. Minor consistency issue.

---

## Positive Observations

- Entity registrations correct in both `database.module.ts` (global) and `lesson.module.ts` (feature) -- avoids the runtime `EntityMetadataNotFoundError` documented in CLAUDE.md
- Migration has proper `down()` method with correct drop order (respects FK dependencies)
- Good index coverage on `category_id`, `language_id`, `difficulty`, `is_active`, `user_id`
- DTO validation with `class-validator` + global `ValidationPipe` with `whitelist: true` prevents mass assignment
- Search uses parameterized query (`:search`) -- no SQL injection risk despite ILIKE
- Pagination has `@Max(50)` cap on `limit` -- prevents unbounded result sets
- Clean separation: controller thin, service handles logic, DTOs typed

---

## Recommended Actions (prioritized)

1. **[Critical]** Fix subscription status check to account for expired/cancelled
2. **[High]** Refactor subquery to use `qb.subQuery()` for parameter safety
3. **[Medium]** Add `@MaxLength(100)` to search DTO
4. **[Medium]** Document or remove `LEARNED` status
5. **[Low]** Add trigram index for title search when dataset grows
6. **[Low]** Clarify pagination contract (total = scenarios, not categories)

## Unresolved Questions

- Is the `LEARNED` status part of an upcoming progress tracking feature, or speculative?
- Should the visibility query also filter by `category.is_active`? Currently inactive categories still show if their scenarios are active.
- The subscription check uses `findOne({ where: { userId } })` without checking `status: ACTIVE`. If a user has multiple subscription records (e.g., after renewal), which one wins? TypeORM `findOne` returns the first match with no guaranteed ordering.
