# Brainstorm — `/users/me` telemetry + response reshape

Date: 2026-04-25
Author: brainstormer
Scope: be_flowering

## Problem

Mobile pings `/users/me` on app foreground. Two changes:
1. Each call carries device telemetry → persist to a new table.
2. Reshape response into `{ profile, subscription }`, with subscription tier/status enums that don't match current DB.

## Decisions (locked with user)

| # | Decision |
|---|---|
| 1 | Telemetry: **append-only event log** (every call = new row). |
| 2 | Transport: **POST `/users/me`** (replaces GET; carries telemetry body, returns profile+subscription). PATCH `/users/me` stays for profile updates. |
| 3 | Subscription enums: **add `tier` column** (FREE / TRIAL / PREMIUM / PREMIUM_PLUS), separate from existing `plan` (billing period). Status enum: add `PENDING`. |
| 4 | Response: **hard break** — replace flat shape. |
| 5 | IDFA: **stored raw, no retention limit** (⚠ flagged below). |
| 6 | Dates: **ISO 8601** for `end_date`. |
| 7 | Timestamps: **client `time_stamp` only** (per spec). |

## Approach

### A. New table `user_device_events` (append-only)

```
user_device_events
  id              uuid pk
  user_id         uuid fk users(id) ON DELETE CASCADE, indexed
  device_model    varchar(120) nullable
  client_timestamp timestamptz   (from mobile)
  time_zone       varchar(64)   (IANA, e.g. "Asia/Ho_Chi_Minh")
  idfa            varchar(64) nullable
  enable_noti     boolean not null
  created_at      timestamptz default now()  (server insert time, kept for audit)
```

- Index: `(user_id, created_at DESC)` for "latest device snapshot per user" queries.
- No unique constraint — every POST `/users/me` inserts.
- Migration registers entity in BOTH `database.module.ts` and `user.module.ts` per CLAUDE.md rule.

### B. Subscription schema delta

Current `subscriptions.plan` enum stays (billing-period semantics). Add:

```
subscriptions
  + tier   enum('FREE','TRIAL','PREMIUM','PREMIUM_PLUS') default 'FREE'
  ~ status enum + 'PENDING'
```

- Migration backfill: rows where `status='trial'` → `tier='TRIAL'`; rows where `plan='free'` → `tier='FREE'`; everything else → `tier='PREMIUM'` (conservative default; product can promote yearly→PREMIUM_PLUS later).
- RevenueCat webhook handler (`subscription/webhooks/`) updated to set `tier` based on entitlement metadata. Out of scope for this brainstorm but flagged as follow-up.

### C. API surface

```
POST /users/me                     ← NEW behavior (was GET)
  body: {
    device_model: string,
    time_stamp:   string (ISO 8601, client clock),
    time_zone:    string (IANA),
    IDFA:         string | null,
    enable_noti:  boolean
  }

  response:
  {
    code: 1,
    message: "Success",
    data: {
      profile: {
        display_name:    string,
        email:           string,
        avatar_url:      string | null,
        native_language: string  // language code, e.g. "en"
      },
      subscription: {
        status:   "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING",
        type:     "FREE" | "TRIAL" | "PREMIUM" | "PREMIUM_PLUS",
        end_date: string | null   // ISO 8601, e.g. "2026-12-31"
      }
    }
  }

PATCH /users/me                    ← unchanged (profile updates)
GET   /users/me                    ← REMOVED (hard break)
```

Service flow on POST:
1. Validate DTO (class-validator).
2. Insert `user_device_events` row (fire-and-forget — failure does NOT block response; logged as warn).
3. Load user + nativeLanguage relation.
4. Load subscription (left-join; default FREE/ACTIVE if missing).
5. Map → response shape.

## Files touched

**New**
- `src/database/entities/user-device-event.entity.ts`
- `src/database/migrations/<ts>-add-user-device-events-and-subscription-tier.ts`
- `src/modules/user/dto/device-telemetry.dto.ts`
- `src/modules/user/dto/me-response.dto.ts` (nested `profile` + `subscription`)
- `src/modules/user/services/device-event.service.ts`

**Modified**
- `src/database/entities/subscription.entity.ts` (+ tier enum, + PENDING status)
- `src/database/entities/index.ts`
- `src/database/database.module.ts` (register new entity)
- `src/modules/user/user.module.ts` (register entity, register new service)
- `src/modules/user/user.controller.ts` (GET → POST, accept body, new return type)
- `src/modules/user/user.service.ts` (extend `getProfile` to include subscription)
- `src/modules/user/user.controller.spec.ts`, `user.service.spec.ts`
- `docs/api-documentation.md`, `docs/code-standards.md` (response shape change)

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **IDFA stored raw forever** — Apple ATT + GDPR exposure. DSAR/right-to-erasure via cascade only. | User accepted. Recommend revisiting before any analytics use. At minimum: ensure `ON DELETE CASCADE` works (it does, via `user_id` FK). |
| Event table growth — `/users/me` is hot. ~1 row per app-open per user. | Plan a partition strategy or scheduled prune job in a follow-up. Add `created_at` index now to keep future deletes cheap. |
| Mobile clock skew — `time_stamp` from device may be wrong/spoofed. | Decision is "client time only". Server `created_at` is still implicitly available for audit; consumers should be aware client time is untrusted. |
| Hard break — old app builds will crash on `/users/me`. | Force-update gate on mobile before backend deploy. Coordinate release. |
| `tier` backfill is a guess (yearly→PREMIUM vs PREMIUM_PLUS). | Backfill conservatively to PREMIUM; product/ops promotes specific users via RevenueCat reconcile job. |
| GET → POST change breaks any cache layers / analytics counting GET hits. | Audit Cloudflare/Railway logs after deploy; update dashboards. |

## Out of scope

- RevenueCat webhook tier mapping (separate task).
- Event-log retention/partitioning (follow-up).
- Android GAID equivalent of IDFA (mobile sends `IDFA` field name only per spec; if Android contributes, reuse same column).
- IDFA hashing (rejected by user; flagged).

## Success criteria

- POST `/users/me` returns new shape; integration test asserts structure.
- Each call inserts exactly one `user_device_events` row.
- Telemetry write failure does NOT fail the request (resilience test).
- Subscription with `tier='PREMIUM_PLUS'` surfaces correctly in response.
- Migration runs cleanly on a copy of prod data; rollback tested.
- `npm run build` clean; all existing user/subscription tests still green.

## Open questions

- Will Android send IDFA-equivalent (GAID) in the same field, or send `null`? Need mobile confirmation.
- Should `enable_noti=false` auto-deactivate the user's `device_tokens` rows? (Reasonable side-effect; needs product call.)
- Is `display_name` allowed to be null/empty in response, or fall back to email-prefix?

## Next step

User to choose: invoke `/ck:plan` to break this into phases, or end session.
