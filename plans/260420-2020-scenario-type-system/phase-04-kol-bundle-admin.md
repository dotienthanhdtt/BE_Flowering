# Phase 04 — KOL Bundle Admin Endpoints

## Context Links

- Brainstorm: `kol_bundles` + `kol_bundle_scenarios` sections (scope ambiguous — brainstorm doesn't define CRUD endpoint shape)
- Phase-01 artifacts: `KolBundle`, `KolBundleScenario` entities
- Phase-02 artifacts: `RolesGuard`, `@Roles()` decorator

## Overview

- Priority: P2
- Status: done
- **Scope flagged open in plan.md — confirm with product before building.**
- Minimal admin-only endpoints to create KOL bundles and attach scenarios. Gives QA + clients a way to seed data before end-to-end redeem testing in phase-05.

## Key Insights

- If KOLs self-serve later, swap `@Roles('admin')` for `@Roles('admin', 'kol')` with ownership check (`bundle.creatorId === user.id`). Not needed now.
- Brainstorm states: "Validate non-empty at bundle creation time, not at redeem." Implement in bundle-creation path.
- Brainstorm: `scenarioId` UNIQUE in `kol_bundle_scenarios` — one scenario per bundle across entire table. Attempting to attach an already-attached scenario returns 409.
- Brainstorm: "Bundle scenario type validation skipped — accept risk of DEFAULT scenario leaking into bundle." Do not enforce `type='kol'` on attach.
- Gift code normalization (uppercase trim) happens on CREATE, not just redeem — mirrors server-side policy.

## Requirements

### Functional

#### `POST /admin/kol-bundles`
- Auth: JWT + `@Roles('admin')`.
- Body: `{ giftCode, creatorId, title, description?, scenarioIds: string[] (min 1) }`.
- Flow (transaction):
  1. Normalize `giftCode.trim().toUpperCase()`.
  2. Validate `creatorId` exists and has `'kol'` in `users.roles` — else 400.
  3. Validate `scenarioIds` non-empty and all scenarios exist + not already attached to any bundle — else 400/409.
  4. Insert `kol_bundles` row.
  5. Insert `kol_bundle_scenarios` rows.
  6. Return full bundle with attached scenarios.
- 409 on duplicate gift code.

#### `GET /admin/kol-bundles`
- Auth: JWT + `@Roles('admin')`.
- Query: `page`, `limit`, optional `giftCode` (exact match normalized).
- Returns paginated bundles with attached scenario IDs (not full scenarios — keep payload lean).

#### `POST /admin/kol-bundles/:id/scenarios`
- Auth: JWT + `@Roles('admin')`.
- Body: `{ scenarioIds: string[] }`.
- Attaches additional scenarios to an existing bundle. Rejects any scenario already attached to ANY bundle (409 with list).

### Non-Functional

- All operations atomic via TypeORM `DataSource.transaction` or `queryRunner`.
- Files under 200 lines.

## Architecture

```
src/modules/kol-bundle/
  kol-bundle.controller.ts          (mounted at /admin/kol-bundles)
  kol-bundle.service.ts
  kol-bundle.module.ts
  dto/
    create-kol-bundle.dto.ts
    attach-scenarios.dto.ts
    list-kol-bundles-query.dto.ts
    kol-bundle-response.dto.ts
```

## Related Code Files

### Modify

- `src/app.module.ts` — import `KolBundleModule`

### Create

- `src/modules/kol-bundle/kol-bundle.controller.ts`
- `src/modules/kol-bundle/kol-bundle.service.ts`
- `src/modules/kol-bundle/kol-bundle.module.ts`
- `src/modules/kol-bundle/dto/create-kol-bundle.dto.ts`
- `src/modules/kol-bundle/dto/attach-scenarios.dto.ts`
- `src/modules/kol-bundle/dto/list-kol-bundles-query.dto.ts`
- `src/modules/kol-bundle/dto/kol-bundle-response.dto.ts`

## Implementation Steps

1. Create DTOs:
   - `CreateKolBundleDto`: `@IsString() @MaxLength(50) giftCode`, `@IsUUID() creatorId`, `@IsString() @MaxLength(255) title`, `@IsOptional() @IsString() description`, `@IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) scenarioIds`.
   - `AttachScenariosDto`: `scenarioIds: string[]` same validators.
   - `ListKolBundlesQueryDto`: page, limit, optional giftCode.
   - `KolBundleResponseDto`: `id, giftCode, creatorId, title, description, scenarioIds[], createdAt`.
2. Implement `KolBundleService`:
   - `create(dto)`: normalize code, validate creator role, validate scenario IDs via `In` + count match; guard against any already-attached scenarios via `kolBundleScenarioRepo.exist({ scenarioId: In(ids) })`; wrap inserts in `DataSource.transaction`.
   - `list(query)`: `findAndCount` with relations via LEFT JOIN to get attached scenarioIds (use `leftJoinAndMapMany` or manual aggregation).
   - `attachScenarios(bundleId, dto)`: find bundle or 404; validate scenarios not attached elsewhere; insert rows in transaction.
3. Implement `KolBundleController`:
   - `@Controller('admin/kol-bundles')`, `@UseGuards(RolesGuard)`, `@Roles('admin')`, `@SkipLanguageContext()` (admin routes don't need language header).
   - Three handlers mirroring service methods.
4. Wire `KolBundleModule`:
   - `TypeOrmModule.forFeature([KolBundle, KolBundleScenario, Scenario, User])`
5. Import in `app.module.ts`.
6. `npm run build` passes.
7. Manual curl:
   - Promote a user to `'kol'` role via SQL.
   - `POST /admin/kol-bundles` with that user as creator.
   - Then exercise phase-03 `/scenarios/redeem` against that bundle.

## Todo List

- [x] Confirm scope with product (admin-only or KOL self-serve)
- [x] DTOs (4 files)
- [x] `KolBundleService` with transactions
- [x] `KolBundleController` with 3 endpoints
- [x] `KolBundleModule` + register in `app.module.ts`
- [x] `npm run build` passes
- [x] Manual curl: create bundle -> redeem happy path

## Success Criteria

- Admin can create bundle with 1+ scenarios via single POST.
- Duplicate gift code rejected 409.
- Attaching scenario already in another bundle rejected 409.
- Creator must have `'kol'` role or 400.
- Phase-05 e2e can seed bundles via these endpoints instead of raw SQL.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Scope creep — KOL self-serve bolted on last minute | Med | Med | Flag in plan.md; defer to follow-up plan |
| Transaction boundary leaks (scenario attached but bundle insert failed) | Low | High | Use `DataSource.transaction` explicitly; don't rely on cascading saves |
| `users.roles` validation goes stale if creator role removed later | Low | Low | Validate at create time; acceptable if creator later loses KOL role |
| Attach duplicate across bundles — DB unique constraint error surfaces as 500 | Med | Low | Pre-check `exists` before insert; catch `QueryFailedError` code 23505 as 409 |

## Security Considerations

- Admin-only — `RolesGuard` + `@Roles('admin')` mandatory.
- Gift code length capped 50 chars (matches schema).
- No PII in response — only bundle metadata and scenario IDs.

## Next Steps

- Phase-05 e2e tests use these endpoints for fixture setup.
