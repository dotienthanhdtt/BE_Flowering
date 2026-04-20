# Mobile API Update — Scenario Types, Roles, KOL Bundles

**Date:** 2026-04-20
**Backend branch:** `dev` (all changes merged)
**Base URL:** `http://localhost:3000` (dev) | prod via env
**Keys:** `snake_case` | **Wrapper:** `{ code, message, data }` | **Auth:** `Authorization: Bearer <jwt>`

All changes below are **LIVE on `dev`** — mobile can integrate against them now.

Source plans:
- `plans/260420-0141-scenario-access-tier-refactor/` — access-tier refactor
- `plans/260420-0158-auto-enroll-language-on-lessons/` — auto-enroll on `/lessons`
- `plans/260420-2020-scenario-type-system/` — scenario type + roles + KOL bundles

---

## 1. Access tier refactor (breaking)

**Affects:** `GET /lessons`, `GET /scenarios/default`, `GET /scenarios/personal`, admin content endpoints.

### 1.1 Dropped fields
These scenario/lesson fields are **removed from API responses** — do not read them:
- `is_premium`
- `is_trial`
- `is_active`

### 1.2 New fields
- `access_tier: "free" | "premium"` — gating flag (replaces `is_premium`).
- `status: "draft" | "published" | "archived"` — lifecycle (replaces `is_active`; clients only ever see `published`).
- Trial concept is collapsed into `free`. Do not special-case trial anywhere.

### 1.3 Scenario status enum (computed, per-user)
`status` on a scenario **card** in list responses (distinct from the lifecycle column above) is the computed user-state enum:

| Value | Meaning |
|---|---|
| `available` | Accessible to this user (free tier, or premium tier + active subscription, or explicit user-granted access) |
| `locked` | `access_tier == "premium"` and user has no active subscription |
| `learned` | User has completed the scenario |

**`trial` is removed.** If your client shipped with `trial` handling, delete that branch.

### 1.4 Example — `GET /lessons`
```json
{
  "code": 1,
  "message": "ok",
  "data": {
    "total": 45,
    "page": 1,
    "limit": 10,
    "categories": [
      {
        "id": "uuid",
        "name": "Greetings",
        "icon": "url",
        "scenarios": [
          {
            "id": "uuid",
            "title": "Meet & Greet",
            "difficulty": "beginner",
            "status": "available",
            "access_tier": "free"
          }
        ]
      }
    ]
  }
}
```

### 1.5 Auto-enroll on `X-Learning-Language`
**Applies to `/lessons` and the new `/scenarios/*` list endpoints.** Sending a `X-Learning-Language` header for a language the user is NOT yet enrolled in no longer returns `403`. Backend auto-creates a `user_languages` row as **inactive** (previously-active language stays active). Content is returned filtered by that language.

- No DTO change. Client can freely switch languages in the browse flow.
- Other endpoints (`/scenario/chat`, `/ai/*`, `/progress`, etc.) keep the strict `403` behavior.
- Activating the language still requires an explicit `POST /languages/user` or `PATCH /languages/user/:id`.

---

## 2. Role model + scenario type discriminator

### 2.1 User roles (replaces `isAdmin`)
- `users.is_admin: boolean` is **dropped**.
- Replaced by `users.roles: string[]` (values: `"user"`, `"admin"`, `"kol"`; default `["user"]`; admins backfilled to `["admin","user"]`).
- Backend did not expose `is_admin` in any mobile endpoint — mobile should have no runtime break. If any debug screen reads it, switch to `roles.includes("admin")`.

### 2.2 Admin endpoints now role-guarded
All `/admin/content/*` and `/admin/kol-bundles/*` endpoints are gated by `@Roles('admin')` — a user without `"admin"` in `roles[]` gets `403`. Error shape unchanged.

### 2.3 Scenario `type` discriminator (new column)
Every scenario now carries:
```
type: "default" | "kol"
```

- `default` — platform-provided, shown in the default scenarios feed.
- `kol` — created by a KOL; only accessible to users who redeemed the KOL's gift bundle.
- All pre-existing scenarios are backfilled to `"default"`.
- **Action for mobile:** read `type` on scenario payloads and branch icon/label if needed. The personal feed (§3.2) mixes both.

### 2.4 Removed: `scenarios.gift_code`
Previously an unused column on `scenarios`; now gone. Not exposed on any mobile endpoint — no client change. Gift codes now live on `kol_bundles` and are redeemed via `POST /scenarios/redeem` (§3.3).

---

## 3. Scenarios module — new endpoints

New controller at **`/scenarios`** (distinct from existing `/scenario/chat`). All endpoints require JWT.

### 3.1 `GET /scenarios/default` — paginated default scenarios
- **Auth:** JWT required. `X-Learning-Language` header required (auto-enroll applied).
- **Query:** `?page=1&limit=20`
- **Filters server-side:** `type = 'default'`, `status = 'published'`, language from header.
- **Ordering:** `order_index ASC`, then `created_at DESC`.
- **Premium lock:** client-side concern — server returns all tiers.

```json
// Response data
{
  "items": [
    {
      "id": "uuid",
      "title": "Ordering Coffee",
      "description": "Practice café conversation",
      "image_url": "https://…",
      "difficulty": "beginner",
      "language_id": "uuid",
      "access_tier": "free",
      "order_index": 1
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42 }
}
```

### 3.2 `GET /scenarios/personal` — user's personal feed
Merges two sources:
- **`personalized`** — AI-generated scenarios from onboarding (stored in `user_ai_scenarios`).
- **`kol`** — KOL scenarios the user unlocked via gift-code redeem (via `user_scenario_access`).

- **Auth:** JWT required. `X-Learning-Language` header required (auto-enroll applied).
- **Query:** `?page=1&limit=20`
- **Ordering:** `added_at DESC` (newest first across both sources).

```json
// Response data
{
  "items": [
    {
      "id": "uuid",
      "title": "Resume interview practice",
      "description": "…",
      "difficulty": "intermediate",
      "language_id": "uuid",
      "added_at": "2026-04-19T10:00:00Z",
      "source": "personalized"
    },
    {
      "id": "uuid",
      "title": "Street food ordering (KOL Mai)",
      "description": "…",
      "difficulty": "beginner",
      "language_id": "uuid",
      "added_at": "2026-04-18T09:00:00Z",
      "source": "kol"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 8 }
}
```

**`source` field** is the union discriminator — use it to route to the right detail screen / iconography.

### 3.3 `POST /scenarios/redeem` — redeem a KOL gift code
- **Auth:** JWT required. **No `X-Learning-Language` header needed.**
- **Rate-limited:** 5 requests / minute.
- **Normalization:** server uppercases and trims `gift_code`.
- **Idempotent:** repeated redemption of the same code returns the same scenario list (no error).

```json
// Request
{ "gift_code": "MAI2026" }

// Response data (200)
{
  "scenarios": [
    {
      "id": "uuid",
      "title": "Street food ordering (KOL Mai)",
      "description": "…",
      "difficulty": "beginner",
      "language_id": "uuid",
      "access_tier": "free"
    }
  ]
}
```

**Errors:**
- `404` — unknown gift code (`{ code: 0, message: "Gift code not found", data: null }`).
- `429` — rate limit exceeded.
- `400` — missing/malformed `gift_code`.

After redeem, the returned scenarios become visible in `GET /scenarios/personal` with `source: "kol"`.

### 3.4 Admin — KOL bundle CRUD (admin-only)
Not consumed by the end-user mobile app. Summary for completeness (admin web / debug view):

- `POST /admin/kol-bundles` — create bundle `{ gift_code, creator_id, title, description?, scenario_ids[] }`.
- `GET /admin/kol-bundles?page=&limit=&gift_code=` — list bundles.
- `POST /admin/kol-bundles/:id/scenarios` — attach more scenarios.

Guarded by `@Roles('admin')` (403 otherwise). `gift_code` is normalized uppercase server-side; duplicate codes return `409`; attaching a scenario already owned by another bundle returns `409`.

---

## 4. Migration checklist for mobile

- [ ] **Remove** all reads of `is_premium`, `is_trial`, `is_active` from scenario/lesson payloads.
- [ ] **Remove** any UI branch on scenario `status == "trial"`.
- [ ] **Adopt** `access_tier: "free" | "premium"` for premium gating UI.
- [ ] **Adopt** `status: "available" | "locked" | "learned"` (computed user-state, list responses).
- [ ] **Verify** `/lessons` with a new `X-Learning-Language` no longer surfaces a `403` toast (now succeeds and auto-enrolls inactive).
- [ ] **Adopt** `type: "default" | "kol"` field on scenario models (§2.3).
- [ ] **Wire** `/scenarios/default` — default feed, paginated.
- [ ] **Wire** `/scenarios/personal` — merged personal feed, `source` discriminator.
- [ ] **Wire** `/scenarios/redeem` — gift code input UI, idempotent retry safe, surface 404/429/400.
- [ ] **Replace** any lingering `is_admin` check with `roles.includes("admin")` (only if surfaced client-side).

---

## 5. Unresolved / open questions

1. Does the existing `/lessons` response stay category-grouped, or does mobile migrate to the flat `/scenarios/default` feed? Backend ships both; cut-over timing is a mobile call.
2. Should `/scenarios/personal` include `image_url`? Current shape omits it to keep payload lean — confirm if the UI needs it.
3. `/scenarios/redeem` throttler is keyed by IP (default). Switching to per-user keying is trivial if you expect shared-device friction.
4. Any KOL-facing self-serve bundle management in V1, or admin-only is sufficient?
