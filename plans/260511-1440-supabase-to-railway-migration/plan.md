---
title: Supabase → Railway migration (dev env)
status: completed
created: 2026-05-11
completed: 2026-05-12
mode: auto
blockedBy: []
blocks: []
---

> **Status (2026-05-12):** Done. Dev backend live on Railway at https://dev.broduck.me —
> `/languages` 200 with migrated data + working `/assets/*` flag/scenario images; auth guard
> returns clean 401s; CI green. Earlier 502 on dev.broduck.me was a TLS-vs-internal-Postgres
> issue, fixed in commit `b292e212` (SSL only for externally-hosted DBs). Docker `npm ci`
> breakage fixed in `d79e1b8`. Remaining: rotate exposed credentials; prod env migration
> (when ready, merge to `main` + set prod vars); replace/remove the dead Cloudflare step in
> `.github/workflows/deploy.yml`.

# Supabase → Railway Migration (dev)

Move dev backend off Supabase: Postgres `public` schema + all data → Railway Postgres;
file storage (Supabase Storage `audio-files`) → Railway S3-compatible bucket
(`compact-samosa-4waqziim5o` @ `https://t3.storageapi.dev`). Drop RLS (inert — app
connects as superuser and enforces auth via global JWT guard).

**Scope:** dev only. Prod migration deferred.

## Brainstorm source
See session brainstorm (2026-05-11). Key decisions: schema+all data, drop RLS, Railway bucket for storage.

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 1 | [DB → Railway](phase-01-db-dump-restore.md) | ✅ done | — |
| 2 | [Drop-RLS migration](phase-02-drop-rls-migration.md) | ✅ done (written + applied to Railway) | 1 |
| 3 | [Storage service → S3 client](phase-03-storage-s3-swap.md) | ✅ done (code) | — |
| 4 | [Config + env cutover](phase-04-config-env-cutover.md) | pending (needs user: set `.env` + Railway vars) | 1,3 |
| 5 | [Smoke test + cleanup](phase-05-smoke-test-cleanup.md) | pending (needs user: run app, **rotate creds**) | 2,4 |

### What was actually done for Phase 1 (2026-05-11)
Local `pg_dump` wasn't installed and Supabase's direct host is unreachable from the dev box, so instead of a live `pg_dump | pg_restore`:
- Applied the repo's existing schema-only dump `plans/reports/schema-dump.sql` (itself a `pg_dump` from Supabase, PG18.3 — matches Railway) to the Railway DB after `DROP SCHEMA public CASCADE` + creating `extensions` schema with `uuid-ossp`/`pgcrypto`.
- Copied all table data (1,840 rows across 23 tables, incl. the 53-row `migrations` table) from Supabase via the Supabase MCP `execute_sql` (json_agg → applied with `session_replication_role = replica` to skip FK order).
- Fixed sequences (`migrations_id_seq`), disabled RLS on all public tables, recorded `DropSupabaseRls1781000000000`. `migration:run` against Railway → "No migrations are pending".
- Row counts verified on Railway = source: users 7, languages 10, scenarios 127, ai_conversations 176, ai_conversation_messages 947, vocabulary 83, vocabulary_injection_events 312, framework_levels 49, refresh_tokens 54, user_languages 10, scenario_categories 7, webhook_events 4, subscriptions 1, rest 0.

## Key constraints
- Schema uses `extensions.uuid_generate_v4()` (schema-qualified) → Railway needs an
  `extensions` schema with `uuid-ossp` installed there *before* restore.
- `pg_dump`/`pg_restore` binary major version must match Supabase's Postgres.
- `languages.flag_url` holds full Supabase Storage public URLs — left as-is for dev
  (still resolve); re-host later. Known debt.
- Railway DB password + bucket keys were exposed in chat → rotate after cutover.
- Audio uploads aren't persisted (transcribe uploads then discards path) → no bulk
  audio file copy needed.

## Image assets moved off Supabase Storage (2026-05-11)
The Railway bucket is **private** and ignores per-object public-read ACLs, so static public URLs don't work for it. Instead of leaving flag/scenario images on Supabase:
- Copied 9 objects (8 `language_flag/*.png` ~50KB + 1 `lessones/generated-1772533435885.png` 1.78MB → `lessons/...`) from Supabase public storage into the Railway bucket.
- Added `ObjectStorageService.getObject()` + a `@Public() GET /assets/*path` passthrough (`src/assets.controller.ts`, wired in `AppModule`) that streams objects from the private bucket with cache headers; rejects `..`/empty paths.
- New config `APP_PUBLIC_URL` (default `http://localhost:3000`).
- New migration `1781100000000-rewrite-asset-urls-to-railway.ts` rewrites `languages.flag_url` (×8) and `scenarios.image_url` (×25) from the old Supabase URLs to `${APP_PUBLIC_URL}/assets/...` (also fixes the `lessones`→`lessons` bucket-name typo). **Gotcha:** the migration captures `APP_PUBLIC_URL` at run time — set it before running against a deployed env. Applied to Railway dev (0 rows still reference Supabase). Verified: `GET /assets/language_flag/de.png` → 200 PNG; missing/traversal → 404.
- Side effect: `SUPABASE_*` is now genuinely unused — the Supabase project can be paused once parity is confirmed.

## Red Team Review (2026-05-11)
8 findings, all accepted and folded into phase files (marked `[RT]`):
1. **High** — verify Railway bucket is private; no public ACL on PUT → phase 03 pre-checks
2. **High** — verify `t3.storageapi.dev` supports SigV4 presigned GET; fallback = stream via backend → phase 03 pre-checks
3. **High** — scan `schema-dump.sql` for cross-schema FKs (`auth.users` etc.) before dump → phase 01 step 0b
4. **Med** — stop dev backend before `pg_dump` (avoid write-loss window) → phase 01 step 0
5. **Med** — `dev.dump` has PII/password hashes/tokens: keep untracked, delete after restore → phase 01 notes
6. **Med** — capture + review `pg_restore` stderr; only POLICY/`auth.uid()` errors acceptable → phase 01 step 4
7. **Low** — rollback note (revert env vars; keep Supabase live until parity) → phase 04
8. **Low** — verify the app's DB role actually bypasses RLS rather than assuming → phase 02 step 0

## Done when
`npm run migration:run` clean against Railway; app boots; login + AI conversation
persist; audio transcription uploads to new bucket and signed URL resolves; row counts
match for `users`, `ai_conversations`, `ai_conversation_messages`, `languages`.
