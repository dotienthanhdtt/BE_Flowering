# Phase 03 — Scenarios Module (3 Endpoints)

## Context Links

- Brainstorm: API Design section
- Existing: `src/modules/scenario/scenario-chat.controller.ts` at `/scenario` (chat), `src/modules/lesson/lesson.controller.ts` at `/lessons`
- Decorator: `src/common/decorators/active-language.decorator.ts` (`@ActiveLanguage`, `@AutoEnrollLanguage`)
- Entity access: phase-01 artifacts (`UserAiScenario`, `KolBundle`, `KolBundleScenario`)

## Overview

- Priority: P1
- Status: done
- New controller `ScenariosController` mounted at `/scenarios`, new service `ScenariosListingService`, coexists with `ScenarioChatController` at `/scenario`. Module: `ScenariosModule`.

## Key Insights

- Existing `scenario-chat.module.ts` is tightly scoped to chat flow — do not shoehorn listing into it. Create sibling `scenarios.module.ts` in same folder `src/modules/scenario/`.
- Both JWT + `@AutoEnrollLanguage()` required on the new controller (parity with `/lessons` — enrolls language on header).
- `POST /scenarios/redeem` uses `ThrottlerGuard` with a new throttler name or reuse existing (`ai-short`/`default`). **Decision:** reuse `default` throttler (5/min) — matches admin-content throttler philosophy; redemption is low-frequency.
- Merge strategy for `/scenarios/personal`: two independent queries + in-memory merge + slice. Pagination done AFTER merge — fetch all items then paginate. For now this is acceptable (bounded per user; brainstorm accepts). If N gets large later, switch to SQL UNION ALL with LIMIT pushdown — noted as future optimization, not now (YAGNI).
- `source: 'kol' | 'personalized'` is the union-type discriminator on response items.
- `AccessTier` filter: brainstorm says NO on `/scenarios/default`, return all tiers. Premium lock is client concern.
- Response wrapped automatically by `ResponseTransformInterceptor` to `{ code, message, data }` — DTOs describe only the `data` shape.
- No category grouping on `/scenarios/default` (distinct from `/lessons` which groups by category). Brainstorm shows flat paginated list.

## Requirements

### Functional

#### `GET /scenarios/default?page=1&limit=20`
- JWT required (global guard).
- `x-learning-language` header required; `@ActiveLanguage()` resolves to `{id, code}`.
- `@AutoEnrollLanguage()` — creates `user_languages` row if absent.
- Query: `scenarios WHERE type='default' AND status='published' AND language_id=:langId ORDER BY order_index ASC, created_at DESC LIMIT/OFFSET`.
- Response: `{ items: ScenarioDefaultDto[], pagination: { page, limit, total } }`.

#### `GET /scenarios/personal?page=1&limit=20`
- JWT required, `@AutoEnrollLanguage()`.
- Service flow per brainstorm:
  - Query A: `SELECT * FROM user_ai_scenarios WHERE user_id=:me AND language_id=:lang` -> map to `{ ..., addedAt: createdAt, source: 'personalized' }`
  - Query B: `SELECT s.*, usa.granted_at FROM scenarios s JOIN user_scenario_access usa ON usa.scenario_id = s.id WHERE usa.user_id=:me AND s.language_id=:lang AND s.status='published' AND s.type='kol'` -> map to `{ ..., addedAt: usa.granted_at, source: 'kol' }`
  - Merge, sort by `addedAt DESC`, slice for pagination, compute total from both query counts.
- Response: `{ items: ScenarioPersonalDto[], pagination }` where each item has `{ id, title, description, difficulty, languageId, addedAt, source }`.

#### `POST /scenarios/redeem`
- JWT required. `@ThrottlerGuard` + `@Throttle({ default: { ttl: 60_000, limit: 5 }})`.
- Body: `{ giftCode: string }` — validated `@IsString() @MaxLength(50) @Transform(uppercase trim)`.
- Flow:
  1. `bundle = kolBundleRepo.findOne({ where: { giftCode: normalized } })` — if none, `NotFoundException('Gift code not found')`.
  2. `scenarioIds = kolBundleScenarioRepo.find({ where: { bundleId: bundle.id } }).map(r => r.scenarioId)`. If empty, `NotFoundException` (shouldn't happen — bundle validation in phase-04). Defensive check regardless.
  3. `userScenarioAccessRepo.createQueryBuilder().insert().into(UserScenarioAccess).values(scenarioIds.map(sid => ({ userId: me, scenarioId: sid }))).orIgnore().execute()` — idempotent via `ON CONFLICT DO NOTHING`.
  4. `scenarios = scenarioRepo.find({ where: { id: In(scenarioIds), status: PUBLISHED } })`.
  5. Return `{ scenarios: [...RedeemedScenarioDto] }`.
- If redemption grants 0 new scenarios (all already owned), still return 200 with the scenario list — idempotent.

### Non-Functional

- All 3 endpoints: response time target < 300ms at 99p for default list sizes.
- DTOs have `@ApiProperty` for Swagger, `class-validator` on inputs.
- Files under 200 lines.

## Architecture

```
src/modules/scenario/
  scenarios.controller.ts        <- NEW at /scenarios
  scenarios.module.ts            <- NEW (separate module, mounted in app.module.ts)
  services/
    scenarios-listing.service.ts <- NEW (default + personal)
    scenarios-redeem.service.ts  <- NEW (redeem flow)
  dto/
    list-scenarios-query.dto.ts    (page, limit — reused for both list endpoints)
    scenario-default.dto.ts        (id, title, description, imageUrl, difficulty, languageId, orderIndex)
    scenario-personal.dto.ts       (id, title, description, difficulty, languageId, addedAt, source)
    redeem-scenario.dto.ts         (giftCode input + response wrapper)
    list-scenarios-response.dto.ts (items + pagination, generic-ish)
```

Data flow (`/scenarios/personal`):
```
Controller (@ActiveLanguage) -> Service.listPersonal(userId, langId, page, limit)
  -> QueryA: userAiScenariosRepo.find({ userId, languageId })
  -> QueryB: scenarioRepo.createQueryBuilder().innerJoin(UserScenarioAccess).where(...)
  -> normalize each -> { ..., addedAt, source }
  -> concat -> sort desc -> slice(offset, offset+limit)
  -> return { items, pagination: { page, limit, total: A.len + B.len } }
```

## Related Code Files

### Modify

- `src/app.module.ts` — import `ScenariosModule`

### Create

- `src/modules/scenario/scenarios.controller.ts`
- `src/modules/scenario/scenarios.module.ts`
- `src/modules/scenario/services/scenarios-listing.service.ts`
- `src/modules/scenario/services/scenarios-redeem.service.ts`
- `src/modules/scenario/services/scenarios-listing.service.spec.ts` (phase-05 finalizes)
- `src/modules/scenario/services/scenarios-redeem.service.spec.ts` (phase-05 finalizes)
- `src/modules/scenario/dto/list-scenarios-query.dto.ts`
- `src/modules/scenario/dto/scenario-default.dto.ts`
- `src/modules/scenario/dto/scenario-personal.dto.ts`
- `src/modules/scenario/dto/redeem-scenario.dto.ts`
- `src/modules/scenario/dto/list-scenarios-response.dto.ts`

## Implementation Steps

1. Create DTOs (`list-scenarios-query.dto.ts`, `scenario-default.dto.ts`, `scenario-personal.dto.ts`, `redeem-scenario.dto.ts`, `list-scenarios-response.dto.ts`). Follow shape in Architecture above.
2. Implement `ScenariosListingService`:
   - Inject `Repository<Scenario>`, `Repository<UserAiScenario>`, `Repository<UserScenarioAccess>`.
   - Method `listDefault(languageId, page, limit)`: standard `findAndCount` on Scenario WHERE type='default' AND status=PUBLISHED AND language_id=... with pagination + order.
   - Method `listPersonal(userId, languageId, page, limit)`:
     - Parallel `Promise.all` for both queries.
     - Normalize + concat + sort.
     - Slice by `(page-1)*limit` and `limit`.
     - Return total = A + B length.
3. Implement `ScenariosRedeemService`:
   - Inject repos for `KolBundle`, `KolBundleScenario`, `UserScenarioAccess`, `Scenario`.
   - `redeem(userId, giftCode)`:
     - `normalized = giftCode.trim().toUpperCase()`
     - find bundle, 404 if none
     - list scenario IDs
     - insert access rows with `.orIgnore()`
     - return populated scenarios
4. Implement `ScenariosController`:
   - `@ApiTags('scenarios')`, `@ApiBearerAuth()`, `@ApiHeader('X-Learning-Language')`, `@AutoEnrollLanguage()`.
   - `@Controller('scenarios')` at class level.
   - 3 endpoints with `@ApiOperation` + `@ApiResponse` annotations.
   - `GET /default`, `GET /personal`, `POST /redeem`.
   - Use `@ActiveLanguage()` on list endpoints, NOT on `/redeem` (per brainstorm: redeem has no language header). Apply `@SkipLanguageContext()` **only** on the redeem handler if language guard is global — verify with `LanguageContextGuard` behavior. If guard only enforces on routes that consume `@ActiveLanguage`, no extra decorator needed. **Check:** read `src/common/guards/language-context.guard.ts` before final impl.
   - Apply `@Throttle` + `@UseGuards(ThrottlerGuard)` on `/redeem`.
5. Wire `ScenariosModule`:
   - `TypeOrmModule.forFeature([Scenario, UserAiScenario, UserScenarioAccess, KolBundle, KolBundleScenario])`
   - `ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }])`
   - Providers: both services; controllers: `ScenariosController`.
6. Register `ScenariosModule` in `src/app.module.ts` imports array (after `ScenarioChatModule`).
7. `npm run build` — compile check.
8. Manual curl smoke test (after phase-01 migrations applied):
   - `curl -H 'Authorization: Bearer <jwt>' -H 'X-Learning-Language: en' 'localhost:3000/scenarios/default?page=1&limit=5'`
   - `curl -H 'Authorization: Bearer <jwt>' -H 'X-Learning-Language: en' 'localhost:3000/scenarios/personal'`
   - `curl -XPOST -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' localhost:3000/scenarios/redeem -d '{"giftCode":"TEST"}'` -> expect 404 until phase-04 seeds bundle.

## Todo List

- [x] DTOs (5 files)
- [x] `ScenariosListingService` + listDefault + listPersonal
- [x] `ScenariosRedeemService`
- [x] `ScenariosController` with 3 endpoints
- [x] `ScenariosModule` with TypeOrmModule.forFeature
- [x] Register in `app.module.ts`
- [x] Verify `LanguageContextGuard` interplay with `/redeem`
- [x] `npm run build` passes
- [x] Manual curl smoke checks

## Success Criteria

- `GET /scenarios/default` returns paginated `{ items, pagination }` for provided language.
- `GET /scenarios/personal` returns merged list sorted desc by `addedAt` with correct `source` tag per item.
- `POST /scenarios/redeem` returns 404 on unknown code, 200 with scenarios on valid code, idempotent on re-redeem.
- Swagger at `/api/docs` shows all 3 endpoints with proper tags.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Merge-then-paginate is O(N) per-user — scales poorly past 10k personal items | Low | Med | Acceptable now; future: SQL UNION with LIMIT pushdown |
| `LanguageContextGuard` blocks `/redeem` (no header) | Med | Med | Test; add `@SkipLanguageContext()` on redeem if global guard enforces |
| Race: two clients redeem same code concurrently | Low | Low | `ON CONFLICT DO NOTHING` on user_scenario_access handles it |
| Throttler not applied (global throttler config missing) | Low | Med | Import `ThrottlerModule.forRoot` inside this module; `@UseGuards(ThrottlerGuard)` on controller |
| `@AutoEnrollLanguage()` duplicates enrollment row | Low | Low | Existing decorator handles idempotence (used on `/lessons`) |
| Existing test spec files in scenario module break due to new providers | Med | Low | Phase-05 updates specs; no changes in phase-03 to existing files |

## Security Considerations

- `giftCode` validation: strip whitespace, uppercase; reject empty string via `@IsNotEmpty()`.
- Rate limit per user (not IP) — default throttler keys by IP by default; acceptable for redeem flood but confirm via `ThrottlerGuard` config.
- Response hides internal IDs of failed lookups (generic 404 messages).

## Next Steps

- Phase-04 unblocks: admin bundle CRUD to seed `kol_bundles` rows for QA + phase-05 e2e.
- Phase-05 writes unit + e2e tests for the 3 endpoints.
