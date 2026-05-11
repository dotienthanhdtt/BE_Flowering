# Deployment

The backend runs on **Railway** with managed PostgreSQL 18 and S3-compatible object storage. Deployments are CI/CD-driven via GitHub Actions to Docker Hub + Cloudflare (or Railway directly, depending on active strategy).

## Branch → Environment

| Branch | Environment | Worker name              | Image tag (Docker Hub) |
|--------|-------------|--------------------------|------------------------|
| `dev`  | staging     | `be-flowering-staging`   | `:staging`, `:<sha>`   |
| `main` | production  | `be-flowering-production`| `:production`, `:<sha>`|

`.github/workflows/ci.yml` runs on every PR (lint + build + test).
`.github/workflows/deploy.yml` runs on push to `dev` / `main`: lint, test, build image, push to Docker Hub, then `wrangler deploy --env <staging|production>`.

## Required GitHub Secrets

Set these in **Repo → Settings → Secrets and variables → Actions**:

| Secret                  | Purpose                                                                 |
|-------------------------|-------------------------------------------------------------------------|
| `DOCKERHUB_USERNAME`    | Docker Hub namespace (also used as the image namespace).                |
| `DOCKERHUB_TOKEN`       | Docker Hub access token with read/write to the `be-flowering` repo.     |
| `CLOUDFLARE_API_TOKEN`  | Token with `Workers Scripts:Edit`, `Account:Read`, `Workers R2:Edit`.   |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID.                                                  |

## Manual Setup (one-time)

1. **Docker Hub**
   - Create a public repo `be-flowering` under your namespace.
   - Generate a token (Account Settings → Personal access tokens, Read/Write/Delete).

2. **Cloudflare**
   - Create an API token: dash → My Profile → API Tokens → Create → "Edit Cloudflare Workers" template, scoped to the right account.
   - Note the account ID (right sidebar of the dash).

3. **Wrangler config**
   - Open `wrangler.toml` and replace both `REPLACE_DOCKERHUB_NAMESPACE` occurrences with your Docker Hub namespace (= `DOCKERHUB_USERNAME`).

4. **Worker dependency**
   - The Worker uses `@cloudflare/containers`. Install it as a devDependency before the first deploy:
     ```bash
     npm install --save-dev @cloudflare/containers wrangler
     ```

5. **Runtime secrets (Railway env)**
   - Set Railway environment variables in the project dashboard or via `railway link`:
     ```bash
     # Database
     DATABASE_URL

     # Object Storage (S3-compatible)
     STORAGE_ENDPOINT
     STORAGE_BUCKET
     STORAGE_ACCESS_KEY_ID
     STORAGE_SECRET_ACCESS_KEY
     STORAGE_REGION

     # App config
     APP_PUBLIC_URL (default: https://your-railway-domain.com)

     # Auth, AI, external services
     JWT_SECRET
     OPENAI_API_KEY
     ANTHROPIC_API_KEY
     GOOGLE_AI_API_KEY
     LANGFUSE_PUBLIC_KEY
     LANGFUSE_SECRET_KEY
     FIREBASE_PROJECT_ID
     FIREBASE_CLIENT_EMAIL
     FIREBASE_PRIVATE_KEY
     REVENUECAT_API_KEY
     REVENUECAT_WEBHOOK_SECRET
     SENTRY_DSN
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
     ```
   - Use Railway's variable editor or `railway set VAR=value` to configure

## Deployment Flow

```
push to dev    →  CI passes  →  npm run migration:run (staging DB)
                                npm run build & npm run start:prod
                                → Railway staging environment

push to main   →  CI passes  →  npm run migration:run (prod DB)
                                npm run build & npm run start:prod
                                → Railway production environment
```

Or with Docker (legacy):
```
push to dev    →  build & push docker.io/<ns>/be-flowering:staging
                  wrangler deploy --env staging (if using Cloudflare)

push to main   →  build & push docker.io/<ns>/be-flowering:production
                  wrangler deploy --env production (if using Cloudflare)
```

## Local verification

```bash
# Create .env from .env.example and set Railway variables
cp .env.example .env
# Edit .env with your Railway DATABASE_URL, STORAGE_* vars, etc.

# Run migrations locally (against staging DB, if available)
npm run migration:run

# Start dev server with hot reload
npm run start:dev

# Or build and run production binary
npm run build
npm run start:prod
```

## Rollback (Railway)

```bash
# Deploy a previous commit to staging first for verification
git checkout <previous-commit-sha>
npm run build
git push -f origin staging  # or deploy via Railway UI
npm run migration:run       # Run migrations on staging DB first
npm run start:prod

# If verified, merge to main and deploy to production
# Or use Railway's UI to rollback to a previous deployment
```

## Database Migrations

**Always run migrations before startup in new environments:**

```bash
npm run migration:run  # Applies pending migrations from src/database/migrations/
```

Run during:
1. Local dev after pulling new migration files
2. CI/CD pipeline before container startup (in Procfile or deployment script)
3. Railway prerelease phase (before app scales up)

## Object Storage Migration (from Supabase)

**If migrating an existing Supabase project:**

1. Copy all objects from Supabase Storage public buckets to Railway bucket
2. Update asset URLs in database via migration `1781100000000-rewrite-asset-urls-to-railway.ts`
3. Set `APP_PUBLIC_URL` to your Railway domain before migration runs
4. Verify `/assets/*path` endpoint returns correct objects before deploying to mobile

## Notes / Caveats

- **Credentials Exposed:** If you exposed Railway credentials in git/chat, rotate immediately after deploying
- **Bucket Privacy:** Railway bucket should be private; presigned URLs provide time-limited read access
- **Migration Retries:** Migrations are idempotent; safe to retry if a deploy fails mid-migration
- **Database Backups:** Railway handles automated backups; configure backup retention in project settings
- **Storage Retention:** Object storage has no auto-cleanup; monitor costs and delete old objects (e.g., old audio transcriptions)
