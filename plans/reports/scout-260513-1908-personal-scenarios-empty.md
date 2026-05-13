# Scout Report — `/scenarios/personal` Empty Items

## Endpoint Surface
- Route: `GET /scenarios/personal` — `src/modules/scenario/scenarios.controller.ts:61-73`
- Service: `ScenariosListingService.listPersonal` — `src/modules/scenario/services/scenarios-listing.service.ts:62-121`
- Personal source query: `ScenarioAccessService.listPersonalForUser` — `src/modules/scenario/services/scenario-access.service.ts:109-119`
- KOL source query: inline `createQueryBuilder` in `listPersonal` — `scenarios-listing.service.ts:70-79`
- Decorators: `@AutoEnrollLanguage()` + `@ActiveLanguage()` resolve `lang.id` from `X-Learning-Language` header

## Returned Shape
`{ items: ScenarioPersonalDto[], total: number }` — items is the merged+sorted+paged union of two queries.
**Empty when BOTH queries return zero AND/OR pagination skips past data.**

## Cases that Cause `items = []`

### A. Both source queries empty
The merged set `[personalized..., kol...]` is empty.

1. **Personalized branch (`listPersonalForUser`) empty when ANY:**
   - User has no Scenario row with `type = PERSONAL` + `ownerId = userId` (user never completed personalization intake / never had AI-generated personal scenarios). Created at `personalization.service.ts:245`.
   - User has personal scenarios but **all for other languages** — filter `languageId` (from active language header) excludes them. Switching language with no generated personal scenarios for that language → empty.
   - All matching personal scenarios have `status != PUBLISHED` (e.g. `DRAFT`, `ARCHIVED`). Pruning at `personalization-prune.service.ts` may flip status.
   - Personal scenarios pruned/deleted by `PersonalizationPruneService` quota enforcement.

2. **KOL branch (inline QB) empty when ANY:**
   - No row in `user_scenario_access` for this `userId` (user never redeemed a gift code).
   - User has UserScenarioAccess rows but joined scenarios fail filters:
     - `s.language_id != languageId` (KOL gift in another language than active header).
     - `s.status != PUBLISHED` (KOL scenario unpublished/archived after gift).
     - `s.type != KOL` (the access row points to a non-KOL scenario, e.g. an old PERSONAL — wouldn't happen normally but excluded by filter).
     - `s.owner_id IS NOT NULL` — KOL scenarios are expected `owner_id IS NULL`; if any KOL row has owner set, it's filtered out.

### B. Pagination overshoot
- `merged.slice(offset, offset+limit)` with `offset = (page-1)*limit`.
- If `page * limit > merged.length`, `items` is empty but `total > 0`. E.g. `total=8, page=2, limit=10` → empty page; client must paginate by `total`.
- Default `page`/`limit` from `ListScenariosQueryDto` — if client sends `page=0` or very large `page`, results may be empty or odd.

### C. Language context mismatch
- `@AutoEnrollLanguage()` ensures `UserLanguage` row exists, but does NOT seed PERSONAL scenarios. A freshly-enrolled language has zero PERSONAL/KOL data → empty.
- Header `X-Learning-Language` resolves to a language with no personalized content for this user.

### D. Data integrity edges (less common)
- PERSONAL scenario row with `ownerId = NULL` (orphaned) — excluded.
- KOL row exists but the underlying `Scenario` row was hard-deleted — `innerJoin` returns nothing.
- `UserScenarioAccess.revoked` / time-bound access — current query does **not** filter by any expiry/active flag; check `user-scenario-access.entity.ts` for fields not enforced here (potential bug if access has `expiresAt`/`revokedAt` ignored).

## Likely "Real World" Triggers for Mobile Users
1. New user → has not run personalization intake yet (most common).
2. User switched learning language to one they haven't personalized.
3. User on premium-locked plan after admin un-published scenarios in that language.
4. Client passing wrong `X-Learning-Language` header or stale `lang.id`.
5. Client paginating past end (page index drift after prune).

## Recommendations (if "don't return empty" is the goal)
- **Fallback strategy:** when `merged.length === 0`, return DEFAULT scenarios (`ScenarioType.SYSTEM`) for the active language as a starter set, flagged with `source: 'default'` (would require extending `ScenarioPersonalDto`).
- **Auto-seed:** if user has zero PERSONAL scenarios for active language, trigger personalization intake suggestion or auto-generate a starter PERSONAL scenario.
- **Clamp pagination:** if `offset >= merged.length && merged.length > 0`, return last page instead of empty slice.
- **Surface reason code:** include `emptyReason: 'NOT_PERSONALIZED' | 'WRONG_LANGUAGE' | 'PAGE_OUT_OF_RANGE'` so client can react (CTA to start personalization, switch language, reset page).

## Related Files
- `src/modules/scenario/scenarios.controller.ts:61-73` — route
- `src/modules/scenario/services/scenarios-listing.service.ts:62-121` — listPersonal
- `src/modules/scenario/services/scenario-access.service.ts:109-119` — listPersonalForUser
- `src/modules/scenario/dto/scenario-personal.dto.ts` — DTO shape
- `src/modules/scenario/dto/list-scenarios-query.dto.ts` — page/limit defaults
- `src/modules/personalization/services/personalization.service.ts:245` — PERSONAL creation
- `src/modules/personalization/services/personalization-prune.service.ts` — prune/status changes
- `src/database/entities/user-scenario-access.entity.ts` — KOL access row (verify expiry fields)
- `src/database/entities/scenario.entity.ts` — type, status, ownerId, languageId

## Unresolved Questions
- Does `UserScenarioAccess` have `revokedAt`/`expiresAt` fields that should filter the KOL query? Not currently enforced.
- Desired UX when truly empty: fallback to defaults, auto-seed, or return `total=0` with a reason code?
- Should language auto-fallback to user's primary language if active language has no personal data?
