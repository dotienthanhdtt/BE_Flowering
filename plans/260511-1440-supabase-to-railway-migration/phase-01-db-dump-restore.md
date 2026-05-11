# Phase 01 — DB dump + restore to Railway

**Priority:** high · **Status:** pending (recon done) · No code changes — ops task.

## Goal
Get Supabase `public` schema + all data onto the Railway dev Postgres.

## Recon findings (2026-05-11, via Supabase MCP)
- **Extensions to create on Railway:** `uuid-ossp` and `pgcrypto`, both in schema `extensions`. (Supabase also has `pg_stat_statements`/`supabase_vault`/`plpgsql` — infra, not needed.)
- **Cross-schema FKs: NONE.** All `public` FKs reference `public` tables; no `auth.users`/`storage.*` links. (Red-team #3 cleared — step 0b below is a no-op now, but re-confirm if schema changed.)
- **Data volume: ~2,500 rows total** — mostly `ai_conversation_messages` (~947), `vocabulary_injection_events` (~312), `ai_conversations` (~176), `scenarios` (~127); `users` ~3. `languages` showed 0 in stat estimates — verify with real `COUNT(*)`; if truly empty, the `flag_url`-on-Supabase concern is moot.
- **Connectivity:** `db.<ref>.supabase.co:5432` is unreachable from the dev machine (IPv6-only w/o IPv4 add-on). Use the **pooler** string (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`) or enable the IPv4 add-on. `pg_dump` is NOT installed locally → `brew install postgresql@16` first.

## Steps
0. **[RT] Stop the dev backend** (or accept that any write made after the dump is lost). Migration is not online — quiesce writes before `pg_dump`.
0b. **[RT] Cross-schema dependency scan** — `grep -iE 'auth\.|storage\.|REFERENCES "?auth|REFERENCES "?storage' plans/reports/schema-dump.sql`. If a `public` table FKs into `auth.users` (classic Supabase pattern) or any excluded schema, the restore will fail on that constraint — decide up front whether to drop that FK in a migration or recreate a stub. Don't proceed blind.
1. **Identify Supabase PG version** (Supabase dashboard → Settings → Database, or `SELECT version();`). Install/use a matching `pg_dump`/`pg_restore` (e.g. `brew install postgresql@16`).
2. **Prep Railway DB** — connect with `psql "<railway-url>"` and run:
   ```sql
   CREATE SCHEMA IF NOT EXISTS extensions;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
   CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;  -- only if schema-dump.sql references it
   ```
   (Schema uses `extensions.uuid_generate_v4()` — must resolve at restore time.)
3. **Dump from Supabase:**
   ```bash
   pg_dump -Fc --no-owner --no-acl --no-privileges \
     --schema=public --exclude-schema='auth' --exclude-schema='storage' \
     "<supabase-connection-url>" -f dev.dump
   ```
4. **Restore into Railway** (capture stderr):
   ```bash
   pg_restore --no-owner --no-acl --no-privileges -d "<railway-url>" dev.dump 2> restore.log
   ```
   - `CREATE POLICY ...` statements reference `auth.uid()` → they error and are skipped. Expected. Do **not** pass `--exit-on-error`.
   - **[RT]** Review `restore.log` — the *only* acceptable errors are the `CREATE POLICY` / `auth.uid()` ones (and any pre-decided cross-schema FK from step 0b). Anything else (missing table, type, constraint) → stop and investigate; don't trust the data.
   - The `migrations` table is included → TypeORM will see all past migrations as applied.
5. **Verify** row counts on Railway match Supabase for `users`, `ai_conversations`, `ai_conversation_messages`, `languages`, `user_languages`, `lessons`, `exercises`.

## Risks / notes
- If `extensions.uuid_generate_v4()` still fails: the dump may also contain `CREATE SCHEMA`/extension lines pointing at Supabase internals — strip with `pg_restore -l dev.dump > toc.list`, edit out offending entries, restore with `-L toc.list`.
- **[RT] `dev.dump` contains PII + bcrypt password hashes + refresh tokens.** Keep it out of git, never under `plans/` or any tracked dir, and **delete it** (`dev.dump`, `restore.log`, any `toc.list`) once the restore is verified.

## Todo
- [ ] Stop dev backend (quiesce writes)
- [ ] Cross-schema dependency scan of schema-dump.sql
- [ ] Match pg_dump version
- [ ] Create `extensions` schema + uuid-ossp on Railway
- [ ] Dump from Supabase
- [ ] Restore into Railway + review restore.log
- [ ] Row-count verification
- [ ] Delete dev.dump / restore.log / toc.list
