# Phase 02 — Role System Refactor

## Context Links

- Brainstorm: Role System section
- Related files (grep result):
  - `src/common/guards/admin.guard.ts`
  - `src/common/guards/admin.guard.spec.ts`
  - `src/modules/admin-content/admin-content.service.ts:62` (`set({ isAdmin: true })`)
  - `src/modules/auth/auth.controller.spec.ts:38`
  - `src/modules/auth/auth.service.spec.ts:44`
  - `src/database/entities/user.entity.ts:43` (handled in phase-01)

## Overview

- Priority: P1
- Status: done
- Replace every `isAdmin` read/write with `roles: string[]` semantics. Introduce reusable `RolesGuard`.

## Key Insights

- Only ONE production file reads `isAdmin` today: `AdminGuard`.
- Only ONE production file writes it: `AdminContentService.onModuleInit()` (bootstraps admins from `ADMIN_EMAILS` env).
- Two test files carry `isAdmin: false` fixture data — must update.
- Opportunity: generic `RolesGuard` + `@Roles('admin', 'kol')` decorator — reused by phase-03/04. YAGNI check: KOL endpoints exist in scope (phase-03 `/scenarios/personal` lists KOL scenarios but doesn't require KOL role; phase-04 bundle CRUD may). Build `RolesGuard` only if phase-04 ships; otherwise keep `AdminGuard` and swap implementation. **Decision:** build `RolesGuard` now, replace `AdminGuard` with it — avoids duplication later.

## Requirements

### Functional

- `AdminGuard` replaced by `RolesGuard` + `@Roles('admin')` OR kept as thin wrapper. **Choice:** replace `AdminGuard` entirely with `RolesGuard` + decorator; update `admin-content.controller.ts` accordingly. Removes dead code.
- `admin-content.service.onModuleInit()` bootstraps admins via `roles = array_append(roles, 'admin')` (idempotent — array dedup via helper OR `WHERE NOT ('admin' = ANY(roles))`).
- All test fixtures swap `isAdmin: false` -> `roles: ['user']`.
- JwtStrategy (if it loads user.isAdmin into request) must include `roles` instead.

### Non-Functional

- `RolesGuard` reads metadata via `Reflector.getAllAndOverride(ROLES_KEY, [handler, class])` — standard NestJS.
- Zero runtime references to `isAdmin` after this phase (verify via grep).

## Architecture

```
@Roles(...roles: string[]) decorator -> SetMetadata('roles', roles)
RolesGuard:
  required = reflector.getAllAndOverride('roles', [handler, class])
  if !required or required.length === 0 -> allow
  user = request.user
  if !user?.roles?.some(r => required.includes(r)) -> ForbiddenException
  return true
```

## Related Code Files

### Modify

- `src/common/guards/admin.guard.ts` — DELETE (or keep as deprecated alias re-exporting RolesGuard-bound factory)
- `src/common/guards/admin.guard.spec.ts` — DELETE
- `src/modules/admin-content/admin-content.controller.ts` — replace `@UseGuards(AdminGuard)` with `@UseGuards(RolesGuard)` + `@Roles('admin')`
- `src/modules/admin-content/admin-content.service.ts` — rewrite `onModuleInit` to set roles array instead of `isAdmin`
- `src/modules/auth/auth.controller.spec.ts` — fixture update
- `src/modules/auth/auth.service.spec.ts` — fixture update
- Possibly: `src/modules/auth/strategies/jwt.strategy.ts` if user is projected from DB for request.user (verify)

### Create

- `src/common/guards/roles.guard.ts`
- `src/common/guards/roles.guard.spec.ts`
- `src/common/decorators/roles.decorator.ts` (exports `ROLES_KEY = 'roles'` and `Roles(...roles: string[])`)

### Delete

- `src/common/guards/admin.guard.ts` (after migration)
- `src/common/guards/admin.guard.spec.ts`

## Implementation Steps

1. Grep-wide audit: `grep -rn "isAdmin\|is_admin" src/` — confirm the 7 files found (no drift).
2. Verify `JwtStrategy` — inspect `src/modules/auth/strategies/jwt.strategy.ts` to confirm how `request.user` is populated. If it returns the full User entity, `roles` will be present after phase-01. If it picks fields, add `roles`.
3. Create `roles.decorator.ts`:
   ```ts
   export const ROLES_KEY = 'roles';
   export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
   ```
4. Create `roles.guard.ts` implementing `CanActivate` per Architecture section above; throws `ForbiddenException` with message `"Requires role: <required>"`.
5. Write `roles.guard.spec.ts` covering: no metadata -> allow, user has role -> allow, user missing role -> throw, no user -> throw.
6. Update `admin-content.controller.ts`:
   - `import { RolesGuard } from '@common/guards/roles.guard';`
   - `import { Roles } from '@common/decorators/roles.decorator';`
   - Replace class-level `@UseGuards(AdminGuard)` with `@UseGuards(RolesGuard)` + `@Roles('admin')`
7. Rewrite `admin-content.service.onModuleInit()`:
   ```ts
   await this.userRepo
     .createQueryBuilder()
     .update(User)
     .set({ roles: () => `array_append(array_remove(roles, 'admin'), 'admin')` })
     .where('email = ANY(:emails)', { emails })
     .execute();
   ```
   (`array_remove` then `array_append` ensures idempotent add; avoids duplicate `'admin'` entries.)
8. Update `auth.service.spec.ts` and `auth.controller.spec.ts` fixtures: `isAdmin: false` -> `roles: ['user']`.
9. Delete `admin.guard.ts` + `admin.guard.spec.ts`.
10. Grep again: `grep -rn "isAdmin\|AdminGuard\|is_admin" src/` should return zero hits in `src/` (migration files allowed).
11. `npm run build` passes.
12. `npm test` passes.

## Todo List

- [x] Grep audit for all `isAdmin` / `AdminGuard` references
- [x] Inspect JwtStrategy for user projection
- [x] Create `roles.decorator.ts`
- [x] Create `roles.guard.ts`
- [x] Create `roles.guard.spec.ts`
- [x] Swap `admin-content.controller.ts` guard + decorator
- [x] Rewrite `admin-content.service.ts` onModuleInit
- [x] Update auth test fixtures
- [x] Delete `admin.guard.ts` + spec
- [x] Final grep: zero `isAdmin` references in src/
- [x] `npm run build` + `npm test` green

## Success Criteria

- `grep -rn isAdmin src/` returns zero matches (excluding migrations/comments referring to the refactor).
- `/admin/content` endpoints reject users whose `roles` array lacks `'admin'`.
- Admin bootstrap on server start adds `'admin'` idempotently (run twice — no duplicates).
- Unit tests for `RolesGuard` cover 4 cases (allow, deny, no-user, no-metadata).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| JwtStrategy hasn't surfaced `roles` on request.user | Med | High | Step 2 explicitly inspects JwtStrategy; fix in this phase |
| `array_append` on empty roles creates `{admin}` missing `user` | Low | Low | Phase-01 migration sets default `['user']`; append preserves it |
| Mixed deploy with phase-01 -> `is_admin` dropped while AdminGuard still reads it | High | High | Deploy phase-01 + phase-02 atomically; do not split commits across releases |
| Fixture drift in untouched spec files | Low | Med | Grep for `isAdmin:` in `*.spec.ts` before closing phase |

## Security Considerations

- `RolesGuard` must enforce `roles` array ownership comes from JWT-verified DB projection, not request body.
- Confirm `user.roles` is not writable via any user-facing PATCH endpoint (grep for `@Body()` near `User` updates).

## Next Steps

- Phase-03 can start once `RolesGuard` compiles (phase-04 depends on it too).
