# Brainstorm: Scenario Type System

## Problem Statement

Current `scenarios` table mixes all content types with no type discriminator. As personalized (AI-generated) scenarios grow unboundedly per user, the table will bloat and degrade query performance for default content.

Need to support 3 distinct scenario types with 2 clean APIs.

---

## 3 Scenario Types

| Type | Description | Visibility | Creator |
| --- | --- | --- | --- |
| **DEFAULT** | Fixed content by language | All users learning that language | Admin |
| **PERSONALIZED** | AI-generated per user | Only that specific user | System (AI) |
| **KOL** | Created by KOL/KOC influencer | Users who redeem gift code | KOL user |

---

## Data Model Design

### Keep: `scenarios` table — DEFAULT + KOL only
- Remove `giftCode` column (moves to `kol_bundles`)
- Add `type` enum column: `'default' | 'kol'` — explicit discriminator, never rely on `creatorId IS NULL`
- `creatorId` stays (nullable) — set for KOL scenarios, null for DEFAULT
- Bounded table, never bloats

### New: `user_ai_scenarios` — PERSONALIZED only
```
id              uuid PK  ← uses stable UUID from ai_conversations.scenarios JSONB
userId          uuid FK users (required, indexed)
languageId      uuid FK languages
conversationId  uuid FK ai_conversations  ← trace back to originating conversation
title           varchar
description     text nullable
difficulty      enum (BEGINNER, INTERMEDIATE, ADVANCED)
createdAt       timestamptz
```
- Separate table keeps DEFAULT queries fast regardless of user count
- PK reuses JSONB's stable UUID → `ON CONFLICT DO NOTHING` on re-seed is safe
- No `status` column — personalized scenarios are always active (YAGNI)

### New: `kol_bundles` — KOL campaign/bundle
```
id          uuid PK
giftCode    varchar(50) UNIQUE NOT NULL
creatorId   uuid FK users (must have 'kol' role)
title       varchar
description text nullable
createdAt   timestamptz
```

### New: `kol_bundle_scenarios` — join table
```
bundleId    uuid FK kol_bundles
scenarioId  uuid FK scenarios UNIQUE  ← one scenario per bundle max
PRIMARY KEY (bundleId, scenarioId)
```

### Keep: `user_scenario_access` — KOL redemption tracking
```
userId      uuid FK users
scenarioId  uuid FK scenarios  (no cascade delete — access preserved even if scenario archived)
grantedAt   timestamptz
PRIMARY KEY (userId, scenarioId)
```

---

## Role System

KOL is one of many roles — use a `roles` array on User, not boolean flags.

```
users.roles: text[]  (PostgreSQL array)
  default: ['user']
  values:  'user' | 'admin' | 'kol' | ...

example: ['user', 'kol']  ← KOL who is also a regular learner
```

- Replaces `isAdmin` boolean → migrate `isAdmin=true` to `roles = ['admin']`
- KOL guard: `roles.includes('kol')`
- Extensible without schema changes

---

## Migration Changes

1. Remove `gift_code` column from `scenarios` table
2. Add `type` enum column (`'default' | 'kol'`) to `scenarios`, backfill existing rows
3. Create `user_ai_scenarios` table
4. Create `kol_bundles` table
5. Create `kol_bundle_scenarios` join table (unique on `scenarioId`)
6. Add `roles text[]` column to `users`, default `['user']`
7. Migrate `isAdmin=true` rows → `roles = ['admin']`, drop `is_admin` column

---

## API Design

> `languageId` is resolved server-side from the `x-learning-language` header (language code → UUID lookup).
> No `languageId` query param needed on either endpoint.

> **Migration note:** Client currently calls `GET /lessons` for scenario listing — this is wrong entity/endpoint.
> New endpoints live at `/scenarios`. Client migrates: `GET /lessons` → `GET /scenarios/default`.
> `GET /lessons` remains untouched for actual lesson/exercise content.
> Response DTO will differ — client needs update when switching.

### API 1 — Default Scenarios
```
GET /scenarios/default?page=1&limit=20
Headers: x-learning-language: en
Auth: JWT required
Query: scenarios WHERE type='default' AND status='published' AND language_id=<resolved>
```

### API 2 — Personal Scenarios (Personalized + KOL)
```
GET /scenarios/personal?page=1&limit=20
Headers: x-learning-language: en
Auth: JWT required

Service-layer flow:
  [A] Fetch user_ai_scenarios WHERE user_id=me AND language_id=?
      → alias createdAt AS addedAt, source='personalized'
  [B] Fetch scenarios JOIN user_scenario_access WHERE user_id=me AND language_id=?
      → alias user_scenario_access.grantedAt AS addedAt, source='kol'
  Merge both lists → ORDER BY addedAt DESC → paginate

Response shape per item:
  { id, title, description, difficulty, languageId, addedAt, source: 'kol' | 'personalized' }
```

### Redeem KOL Gift Code
```
POST /scenarios/redeem
Auth: JWT required
Body: { giftCode: string }  ← normalized to uppercase server-side

Flow:
  1. Find kol_bundle by giftCode (404 if not found)
  2. Get all scenarioIds from kol_bundle_scenarios
  3. INSERT INTO user_scenario_access ON CONFLICT DO NOTHING  ← idempotent
  4. Return: { scenarios: [...full scenario objects] }
```

---

## Decisions Log

| Question | Decision |
| --- | --- |
| `user_ai_scenarios` creation trigger | Seeded from `ai_conversations.scenarios` JSONB on conversation completion |
| API 2 pagination | Yes — `page` + `limit`, `ORDER BY createdAt DESC` |
| `source` field in API 2 response | Yes — `'kol'` or `'personalized'` |
| API 2 query strategy | Two separate queries merged in service layer (not raw SQL UNION) |
| KOL role | `roles: text[]` on User (replaces `isAdmin` boolean) |
| KOL bundle expiry | No |
| One scenario per bundle | Yes — unique constraint on `scenarioId` in join table |
| Bundle validation | Validate non-empty at bundle creation time, not at redeem |
| Deleted/archived KOL scenario | Access preserved — no cascade on `user_scenario_access` |
| API 1 auth | JWT required — prevents premium leak + AutoEnrollLanguage conflict |
| DEFAULT discriminator | Explicit `type='default'` column, not `creator_id IS NULL` |
| Gift code format | Normalize to uppercase on save + lookup |
| Redeem rate limiting | Apply ThrottlerGuard to `POST /scenarios/redeem` |
| `user_ai_scenarios.id` | Reuse stable UUID from `ai_conversations.scenarios` JSONB — PK conflict dedupes re-seeds |
| API 2 ordering | `addedAt` alias — `createdAt` from personalized, `grantedAt` from KOL, merged + sorted in service |
| `user_ai_scenarios.status` | Dropped — always active (YAGNI) |
| `user_ai_scenarios.lastAccessedAt` | Dropped — no write trigger defined, add later when needed |
| API 1 accessTier filter | None — return all default scenarios regardless of tier |
| `conversationId` on `user_ai_scenarios` | Added — traces back to originating conversation |
| Redeem response shape | `{ scenarios: [...] }` |
| Bundle scenario type validation | Skipped — accept risk of DEFAULT scenario leaking into bundle |

---

## `user_ai_scenarios` Creation Flow

Source: `ai_conversations.scenarios` JSONB (already stores cached AI-generated scenario payload per conversation with stable UUIDs).

```
Trigger: end of onboarding / conversation completion
Flow:
  1. Read ai_conversations.scenarios JSONB array for that userId + languageId
  2. For each entry → INSERT INTO user_ai_scenarios
       id = JSONB entry's stable UUID
       conversationId = ai_conversation.id
       userId, languageId, title, description, difficulty = from payload
     ON CONFLICT (id) DO NOTHING  ← idempotent, safe to re-run
  3. Scenarios now available via API 2 as source: 'personalized'
```

- No new AI call needed — reuses already-generated payload
- PK conflict on stable UUID makes re-seeding safe
- Decouple trigger timing from this feature (implement when onboarding flow is finalized)

---

## Open Questions

None — all decisions resolved.
