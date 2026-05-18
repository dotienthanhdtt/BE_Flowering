# Deployment

The backend runs on **Railway** (project `Flowering`, service `BE_Flowering`) with a
Railway-managed **PostgreSQL** service and an S3-compatible object-storage bucket (at
`t3.storageapi.dev`). Deploys are driven by Railway's **GitHub integration** — pushing to a tracked
branch triggers a build (from the repo `Dockerfile`) and rollout automatically. No
`railway up` / wrangler step is needed.

## Branch → Environment

| Branch | Railway environment | Public URL                  | DB / storage                                                 |
|--------|---------------------|-----------------------------|--------------------------------------------------------------|
| `dev`  | `dev`               | `https://dev.broduck.me`    | Railway Postgres + S3 bucket `embedded-duffel-wduy-vgp1` (@ `t3.storageapi.dev`) |
| `main` | `production`        | `https://mango.broduck.me`  | Railway Postgres + S3 bucket `flowering-prod-assets` (@ `t3.storageapi.dev`)     |

- `.github/workflows/ci.yml` — runs on PRs (lint + build + test).
- `.github/workflows/deploy.yml` — on push to `dev`/`main`, builds the production Docker
  image and publishes it to Docker Hub as a registry artifact (`:staging` / `:production`
  + `:<sha>`). **This workflow does not deploy** — Railway's GitHub integration does.

## Migration status (Supabase → Railway)

The backend is migrating off Supabase onto Railway primitives.

- **`dev`** — fully on Railway (DB + storage). Done.
- **`production`** — **DB migrated; one runtime secret still missing.** As of 2026-05-12:
  prod Railway Postgres was loaded by `pg_dump`-ing the dev Railway PG and `pg_restore`-ing
  into prod (23 tables, 55 migrations, row counts match dev). Asset URLs in
  `languages.flag_url` / `scenarios.image_url` rewritten `dev.broduck.me` → `mango.broduck.me`.
  Prod storage moved off the dev-shared bucket onto its own bucket `flowering-prod-assets`
  (9 image objects copied; same `t3.storageapi.dev` endpoint + same access keys).
  **The prod deploy still crashes on boot** with
  `REVENUECAT_REST_API_KEY must be set in production` —
  `revenuecat-rest-client.ts` enforces that var only when `NODE_ENV=production`, and it's
  set in neither env. **Fix:** set the RevenueCat REST secret key, then redeploy:
  ```bash
  railway variables --environment production --service BE_Flowering --set "REVENUECAT_REST_API_KEY=sk_..."
  railway environment production && railway redeploy --service BE_Flowering -y
  ```

Prod env vars already set correctly: `NODE_ENV=production`,
`APP_PUBLIC_URL=https://mango.broduck.me`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`
(prod Railway Postgres via `postgres.railway.internal`), `STORAGE_*` → S3 bucket
`flowering-prod-assets` at `https://t3.storageapi.dev`. The `mango.broduck.me`
custom domain `targetPort` is set to `3000` (must match the port the app listens on, or
Railway returns `x-railway-fallback: true` 502s).

## Remaining to fully bring up `production`

1. **Set `REVENUECAT_REST_API_KEY`** (blocking — prod crashes on boot without it):
   ```bash
   railway variables --environment production --service BE_Flowering --set "REVENUECAT_REST_API_KEY=sk_..."
   railway environment production && railway redeploy --service BE_Flowering -y
   ```
2. **Verify the deploy:**
   ```bash
   curl -fsS https://mango.broduck.me/                         # any @Public() route → JSON {code,message,data}
   curl -fsS https://mango.broduck.me/assets/language_flag/en.png -o /dev/null  # storage proxy
   ```
   Should boot cleanly (no `42P01`, no RevenueCat abort).
3. **DNS for `mango.broduck.me`** — already attached to the prod `BE_Flowering` service in
   Railway; ensure the CNAME from Railway → service → Settings → Domains is present at the
   DNS provider and the domain shows `verified`.

(Already done: prod Postgres loaded from the dev Railway PG; asset URLs rewritten to
`mango.broduck.me`; prod storage split onto its own bucket `flowering-prod-assets`. The
empty bucket `embedded-duffel-8nilfpolc` at `t3.storageapi.dev` is unused — delete it from
the storage console; it has separate credentials, not the ones in the Railway env.)

## Required GitHub Secrets

Repo → Settings → Secrets and variables → Actions (only needed for the Docker Hub image
artifact in `deploy.yml`):

| Secret               | Purpose                                                            |
|----------------------|--------------------------------------------------------------------|
| `DOCKERHUB_USERNAME` | Docker Hub namespace (also the image namespace).                   |
| `DOCKERHUB_TOKEN`    | Docker Hub access token with read/write to the `be-flowering` repo.|

(The actual deploy needs no GitHub secrets — Railway pulls from GitHub directly.)

## Runtime env vars (per Railway environment)

Set via the Railway dashboard or
`railway variables --environment <env> --service BE_Flowering --set "K=V"`:

```
# Core
NODE_ENV                # development (dev) | production (prod)
PORT                    # 3000 — must match the custom domain targetPort
APP_PUBLIC_URL          # https://dev.broduck.me | https://mango.broduck.me

# Database (Railway-managed Postgres)
DATABASE_URL            # ${{Postgres.DATABASE_URL}}  (postgres.railway.internal, no TLS)

# Object storage (S3-compatible, t3.storageapi.dev)
STORAGE_ENDPOINT        # https://t3.storageapi.dev
STORAGE_BUCKET          # embedded-duffel-wduy-vgp1 (dev) | flowering-prod-assets (prod)
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY
STORAGE_REGION          # auto

# Auth / AI / external services
JWT_SECRET, JWT_EXPIRES_IN
GOOGLE_CLIENT_ID
OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY
LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
REVENUECAT_API_KEY, REVENUECAT_WEBHOOK_SECRET
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
```

## Local verification

```bash
cp .env.example .env       # then fill in real values
npm run migration:run      # apply pending migrations
npm run start:dev          # hot-reload dev server on :3000
# or: npm run build && npm run start:prod
```

## Migrations on deploy

Migrations run **automatically** on container start via Railway's CI/CD pipeline, before the app boots. The Dockerfile `CMD` (and `Procfile`) chains `typeorm migration:run` → `node dist/main`. If a migration fails, the container exits non-zero and Railway marks the deploy failed (no traffic is routed to a half-migrated app).

**Key Behavior:**
- **On every deploy:** pending migrations run automatically (no manual step)
- **If migration fails:** app does not start; Railway rollback is automatic
- **Idempotent:** TypeORM only runs migrations not yet in the `typeorm_migrations` table

- **Adding a migration**: `npm run migration:generate -- src/database/migrations/<name>`,
  commit, push. Deploy runs it automatically.
- **Never run `migration:run` manually against prod.** The deploy pipeline is the only
  caller.
- **Production runtime uses compiled JS** (`dist/database/typeorm-data-source.js`); local
  dev still uses ts-node via `npm run migration:run`. The data source resolves
  entity/migration globs relative to `__dirname` so both paths work.

## Rollback (Railway)

Use the Railway dashboard → service → Deployments → pick a previous successful deploy →
"Redeploy". Or revert the offending commit on `main` and push — the GitHub integration
redeploys. If a migration is the problem, fix forward (migrations are idempotent / safe to
retry); avoid reverting a migration against prod data without a backup.

## Notes / Caveats

- **Railway internal Postgres serves no TLS** on `*.railway.internal` / `*.rlwy.net` — the
  codebase sets `ssl` conditionally based on the host. Don't force `sslmode=require` for
  the internal URL.
- **Custom-domain `targetPort` must equal the app port (3000).** A mismatch (dev was
  wrongly `8080`) yields `x-railway-fallback: true` 502s despite a healthy deploy.
- **External services must not crash the app on init failure** — Firebase/SMTP init is
  wrapped in try-catch with a degraded-mode flag. Verify Railway env vars are real values,
  not `.env.example` placeholders (`your-xxx`), which pass null-checks but fail at parse
  time.
- **Storage retention** — the bucket has no auto-cleanup; monitor cost and prune stale
  objects (e.g. old audio transcriptions).
- **Credentials hygiene** — if any Railway/DB/storage credential was pasted into git or
  chat, rotate it.
- **Stray empty bucket** `flowering-assets` (id `27718fae-...`) can be deleted from the
  Railway dashboard.
