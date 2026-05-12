# Phase 04 — Config + env cutover

**Priority:** high · **Status:** ✅ done locally — `.env` cut over (DB + storage), app boots clean against Railway, bucket pre-checks pass. Only outstanding: set the same vars on the deployed Railway **service** (user, dashboard). · Depends: Phase 01, 03

## Done (2026-05-11)
- `.env`: `DATABASE_URL` → Railway proxy; `STORAGE_ENDPOINT=https://t3.storageapi.dev`, `STORAGE_BUCKET=compact-samosa-4waqziim5o`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` filled; commented out the now-unused `SUPABASE_*` vars.
- `ObjectStorageService` made boot-tolerant: warns instead of throwing when storage config is absent.
- Verified: `npm run build` clean; `npm run start:dev` against Railway → app starts, `GET /` 200, `/api/docs` 200, reads 49 framework_levels / 10 languages from Railway, no DB errors, no storage warning (configured).
- **Bucket pre-checks (red-team #1, #2) — PASS:** PUT/LIST/DELETE work; presigned GET → 200 with matching body; anonymous GET → 403 AccessDenied → bucket is **private**. SigV4 presigned URLs supported by `t3.storageapi.dev`.

## Outstanding (user)
- Set `DATABASE_URL` + `STORAGE_*` on the deployed Railway service (dashboard → Variables, or attach the bucket so Railway injects the storage vars).

## Goal
Point the dev backend at Railway: DB + storage.

## Steps
1. **Local `.env` (dev):**
   - `DATABASE_URL` → Railway connection string
   - `STORAGE_ENDPOINT=https://t3.storageapi.dev`
   - `STORAGE_BUCKET=compact-samosa-4waqziim5o`
   - `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` → Railway bucket creds
   - Remove or comment `SUPABASE_*` (keep `SUPABASE_URL` only if `languages.flag_url` still served from Supabase and you want to document that)
2. **Railway service env vars** — same set, via dashboard or `railway variables set`. Railway can auto-inject the bucket vars if the bucket is attached to the service — prefer that over hardcoding.
3. **SSL** — `typeorm-data-source.ts` and `database.module.ts` already use `ssl: { rejectUnauthorized: false }`. Confirm that still works against Railway's proxy host; if Railway uses the internal `*.railway.internal` host, SSL may need to be off. Keep dev pointing at the public proxy host given.
4. **Connection pool** — Railway dev Postgres has a lower connection ceiling than Supabase's pooler. If `database.module.ts` sets a large `extra.max`, drop to ~5–10 for dev.
5. `npm run start:dev` — app boots without DB/storage init errors.

## Rollback (RT)
Dev-only, low-stakes: to revert, set `DATABASE_URL` and `STORAGE_*` back to the Supabase values in `.env` + Railway vars and restart. Keep the Supabase dev project live and untouched until Phase 5 confirms parity — do not pause/delete it before then.

## Todo
- [ ] Update local `.env`
- [ ] Update Railway service vars (prefer attached-bucket auto-vars)
- [ ] Verify SSL against Railway proxy host
- [ ] Sanity-check pool size
- [ ] App boots clean
