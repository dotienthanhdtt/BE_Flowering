# Brainstorm — Scenarios Grouped by Category

**Date:** 2026-05-16
**Branch:** dev
**Owner:** DTT

## Problem
Client now displays scenarios grouped by category. A single category bucket must hold both **system (normal)** and **personal/KOL** scenarios. Current API has two flat endpoints (`/scenarios/default`, `/scenarios/personal`) and personal scenarios have `categoryId = NULL`, so grouping is impossible today.

## Goals
- Single endpoint returning categories with mixed-source scenarios.
- Hide empty categories per active language + user.
- Personal scenarios appear in real categories (not a silo).
- Preserve premium-lock stub semantics and language-scoped filtering.

## Non-Goals
- No change to scenario authoring / admin flows beyond category assignment.
- No change to scenario detail endpoint `/scenarios/:id` or redeem endpoint.
- No client-side grouping fallback.

## Decisions (Confirmed)
| Topic | Decision |
|---|---|
| API shape | Replace `/scenarios/default` + `/scenarios/personal` with **single `GET /scenarios`** |
| Pagination | **Paginate categories** (each category returns all its scenarios) |
| Within-category sort | Single recency key: `COALESCE(usa.granted_at, s.created_at) DESC` |
| Item metadata | Include `type` (`system|kol|personal`) and `source` (`personalized|kol|system`) |
| Category order | `scenario_categories.orderIndex ASC` |
| Empty categories | Hidden |
| KOL handling | Treated same as system in grouping (already has `categoryId`) |
| Personal categoryId rule | Onboarding-origin → seed category **"For you"** (per-language); trigger-origin → inherit source scenario's `categoryId` |
| Category language scope | **Full refactor**: add `language_id` to `scenario_categories` (NOT NULL); clone existing categories per active language; backfill `scenarios.category_id` to language-matched clone; `UNIQUE(language_id, slug)` |
| **Default-category fallback** | **DB trigger** on `scenarios` BEFORE INSERT/UPDATE: if `category_id IS NULL`, auto-assign to **"For you" of same `language_id`** (lookup by `slug='for_you'`). Single source of truth; works for every insert path (app, admin, seed, raw SQL) |
| Deprecation strategy | **Hard cut** — remove `/default` + `/personal` in same release; coordinate with mobile build |
| Source-scenario link | New column **`ai_conversations.source_scenario_id`** (nullable UUID); stamped at conversation creation from `PersonalizationOfferedEvent`; read by `completePersonalization` to inherit category |

## API Contract

### `GET /scenarios?page=&limit=`
Header: `X-Learning-Language: <code>` (existing convention via `@AutoEnrollLanguage`).

Response:
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "items": [
      {
        "category": { "id": "uuid", "name": "Travel", "orderIndex": 1 },
        "scenarios": [
          {
            "id": "uuid",
            "title": "...",
            "description": "...",
            "imageUrl": "...",
            "languageId": "uuid",
            "type": "personal",
            "source": "personalized",
            "addedAt": "2026-05-16T...",
            "locked": false
          }
        ]
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 7 }
  }
}
```
- `total` = count of **non-empty categories** for this user+language.
- Locked premium stubs omit `description` / `imageUrl` (matches current behavior in `scenarios-listing.service.ts`).
- `addedAt` = `usa.granted_at` for KOL, `createdAt` otherwise.

## Architecture

### Data flow
```
GET /scenarios
  └─ ScenariosListingService.listGrouped(userId, languageId, page, limit)
       ├─ Step 1: Visible-scenario CTE (SQL)
       │    SELECT s.*, COALESCE(usa.granted_at, s.created_at) AS sort_at,
       │           CASE WHEN usa.user_id IS NOT NULL THEN 'kol' ... END AS source
       │      FROM scenarios s
       │      LEFT JOIN user_scenario_access usa
       │             ON usa.scenario_id = s.id AND usa.user_id = :userId
       │     WHERE s.language_id = :languageId
       │       AND s.status = 'published'
       │       AND s.category_id IS NOT NULL
       │       AND (
       │             (s.type = 'system' AND s.owner_id IS NULL)
       │          OR (s.type = 'personal' AND s.owner_id = :userId)
       │          OR (s.type = 'kol' AND usa.user_id = :userId)
       │       )
       ├─ Step 2: Group by category_id in JS; drop empties (auto by query).
       ├─ Step 3: Page over distinct categories ordered by category.orderIndex ASC.
       ├─ Step 4: Within each page-category, sort by sort_at DESC.
       └─ Step 5: Apply premium-lock stub mapping (preserve existing rules).
```

Single SQL query keeps it KISS — paginate **after** grouping by selecting distinct category_ids for the slice, then fetching only those categories' scenarios. Two-query alternative:
1. `SELECT id, name FROM scenario_categories WHERE id IN (SELECT DISTINCT category_id FROM <visible-scenarios>) ORDER BY order_index LIMIT/OFFSET` → page slice.
2. Fetch scenarios for those category ids.

Two-query path is cleaner; recommend it.

### Personal categoryId assignment

App layer **may** stamp `category_id`. If it doesn't, the DB trigger fills it. Both flows below explicitly set it to avoid surprises and to keep app behavior testable without trigger fixtures:

**Onboarding flow** (`personalization.service.ts:147` `parseScenarios`):
- Look up "For you" by `(language_id, slug='for_you')`.
- Stamp `categoryId = forYouCategory.id` on each generated scenario.

**Trigger flow** (`personalization-trigger.service.ts` → event → `completePersonalization`):
- Propagate `sourceScenarioId` from `PersonalizationOfferedEvent` via `ai_conversations.source_scenario_id`.
- Resolve source scenario's `categoryId`; stamp on generated children.
- If source has no `categoryId` (legacy), let DB trigger default to "For you".

**Safety net — DB trigger:**
```sql
-- Pseudocode; final migration to be authored in implementation phase.
CREATE OR REPLACE FUNCTION scenarios_default_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id
      FROM scenario_categories
     WHERE language_id = NEW.language_id
       AND slug = 'for_you'
       AND is_active = true
     LIMIT 1;
    IF NEW.category_id IS NULL THEN
      RAISE EXCEPTION 'No "for_you" category exists for language_id %', NEW.language_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scenarios_default_category
BEFORE INSERT OR UPDATE OF category_id ON scenarios
FOR EACH ROW EXECUTE FUNCTION scenarios_default_category();
```
Invariant: every active language MUST have a `for_you` category row before this trigger fires. Migration order: create category rows first, then create trigger.

### Schema changes
Migration order matters. Recommended sequence:

1. **`scenario_categories`** — add columns:
   - `slug VARCHAR(64)` (nullable initially) — stable language-agnostic id (`work`, `travel`, `for_you`).
   - `language_id UUID` (nullable initially) — FK to `languages.id`.
   - Backfill `slug` from existing names (kebab-case).
2. **Clone existing categories per active language**:
   - For each existing category row, clone once per active language (drop original after).
   - Backfill `scenarios.category_id` to language-matched clone via `JOIN scenarios s ON s.language_id = new_cat.language_id AND old_cat.slug = new_cat.slug`.
3. **Constraints**:
   - `ALTER scenario_categories.language_id SET NOT NULL`.
   - `ALTER scenario_categories.slug SET NOT NULL`.
   - `UNIQUE (language_id, slug)`.
4. **Seed "For you" per active language** — one row per active language, `slug='for_you'`, translated `name`.
5. **Install `scenarios` BEFORE INSERT/UPDATE trigger** — auto-default `category_id` to per-language `for_you` when NULL (see SQL above).
6. **Backfill legacy NULLs** — `UPDATE scenarios SET category_id = NULL WHERE category_id IS NULL` re-triggered, OR explicit update joining `scenario_categories` on `language_id` and `slug='for_you'`. (Trigger doesn't fire on UPDATE unless `category_id` is in `OF` clause — it is, per the SQL above, so a no-op update suffices.)
7. **`ai_conversations.source_scenario_id UUID NULL`** — add nullable column; stamp at conversation creation in trigger flow.

No new column on `scenarios` required — `category_id` already exists.

**Risk:** steps 2 + 6 are the largest blast radius. Validate invariant before deploy:
`SELECT COUNT(*) FROM scenarios s JOIN scenario_categories c ON c.id = s.category_id WHERE s.language_id <> c.language_id` must equal 0.

### Code touch points
- `src/modules/scenario/scenarios.controller.ts` — delete `/default` + `/personal`; add `GET /`.
- `src/modules/scenario/services/scenarios-listing.service.ts` — replace `listDefault` / `listPersonal` with `listGrouped`.
- `src/modules/scenario/services/scenario-access.service.ts` — may need new method for unified visibility query.
- `src/modules/scenario/dto/list-scenarios-response.dto.ts` — new `CategoryGroupDto` + grouped response.
- `src/modules/scenario/dto/scenario-default.dto.ts` / `scenario-personal.dto.ts` — collapse into one `ScenarioListItemDto` with `type` + `source`.
- `src/modules/personalization/services/personalization.service.ts` — `parseScenarios` accepts categoryId; resolve from onboarding vs trigger origin.
- `src/modules/personalization/services/personalization-trigger.service.ts` + event → carry `sourceScenarioId`.
- New migration: seed "For you" + backfill null categories.
- Update specs: `scenarios-listing.service.spec.ts`, `scenarios.controller.spec.ts` (if exists), personalization specs.

## Alternatives Considered
| Approach | Verdict |
|---|---|
| Keep two endpoints, add `?groupBy=category` flag | Rejected — user wants single endpoint, two endpoints become dead weight. |
| Paginate scenarios within category (preview + see-all) | Rejected — adds endpoint complexity; categories are bounded. |
| Personal as own synthetic category only | Rejected — defeats requirement of mixing into real categories. |
| LLM picks category at generation | Rejected — adds prompt complexity and validation; deterministic rule (For you / parent inherit) is simpler. |
| `createdAt` for all sorting | Rejected — KOL UX needs `granted_at` to surface recently redeemed bundles. |

## Risks
| Risk | Mitigation |
|---|---|
| Breaking change: existing mobile/web clients on `/default` + `/personal` | Coordinate release with client; gate by app version; keep old endpoints for 1 release as deprecated wrappers if needed. |
| Backfill misclassifies existing personal scenarios | Acceptable — "For you" is a safe default; admin can recategorize later. |
| `triggersPersonalization` source scenario has no `categoryId` | Fallback to "For you"; warn-log occurrences. |
| Page-then-group SQL complexity | Use two-query path: paginate distinct categories first, then fetch their scenarios. Avoids window-function fragility. |
| "For you" category leaks for users with zero personal scenarios | Hidden by empty-category filter automatically. |
| KOL granted scenarios with NULL `category_id` | DB trigger auto-defaults to "For you" of matching language. Optional: explicit backfill to bundle's intended category if known. |
| DB trigger fails because no `for_you` row exists for a language | Trigger raises explicit exception; cannot silently corrupt. Migration order guarantees seed runs before trigger install. Adding a new language requires seeding `for_you` row first — document in language-add runbook. |
| Trigger hides app-layer bugs (silent NULL → "For you" coverup) | Acceptable trade-off: trigger is safety net, not primary path. App still stamps explicit `category_id` in known flows; surprise inserts fall to "For you" rather than crash listing. |

## Success Metrics
- Single `GET /scenarios` returns grouped, paginated, empty-categories-hidden data correctly for: free user, premium user, user with personal scenarios, user with KOL grant, user with mixed.
- New onboarding-generated personal scenarios appear under "For you".
- New trigger-generated personal scenarios appear under source scenario's category.
- Existing personal scenarios backfilled and visible.
- All scenario listing specs updated and passing.

## Next Steps
1. Confirm "For you" naming + i18n strategy (single seeded row vs per-language localization).
2. Decide deprecation window for `/default` + `/personal` endpoints (hard cut vs grace period).
3. Decide on `ai_conversations.source_scenario_id` column vs client-supplied `sourceScenarioId` in DTO.
4. Proceed to `/ck:plan` for phased implementation.

## Unresolved Questions
- Should `/scenarios` allow `?categoryId=` filter for direct deep-link to a single category page? (Out of scope unless client needs.)
- Admin authoring flow — does adding a new logical category require creating one row per language manually, or auto-fan-out by slug? (Defer to admin-content module owner.)
- Language-add runbook — when admin adds a new active language, must se/cled `for_you` row (and ideally clone all existing system categories) before any scenario insert. Where does this enforcement live?
- Should the trigger log a warning when it has to default a NULL? Helps catch app-layer paths that forgot to stamp.
