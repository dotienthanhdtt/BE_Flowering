# Deployment

The backend ships as a Docker image hosted on Docker Hub and runs on **Cloudflare Containers**, fronted by a Worker (`worker/index.ts`) that proxies all requests to a single Container Durable Object instance.

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

5. **Runtime secrets (per env)**
   - `wrangler.toml` only declares the container; **runtime env vars** (DB URL, JWT, API keys, etc.) must be set as Worker secrets so they reach the container:
     ```bash
     # staging
     npx wrangler secret put DATABASE_URL --env staging
     npx wrangler secret put JWT_SECRET   --env staging
     # …repeat for every var in .env.example

     # production
     npx wrangler secret put DATABASE_URL --env production
     ```
   - The Worker forwards these into the container's process env automatically via the Container binding.

## Deployment Flow

```
push to dev    →  CI passes  →  build & push docker.io/<ns>/be-flowering:staging
                                wrangler deploy --env staging
                                → https://be-flowering-staging.<account>.workers.dev

push to main   →  CI passes  →  build & push docker.io/<ns>/be-flowering:production
                                wrangler deploy --env production
                                → custom domain (configure routes in wrangler.toml)
```

## Local verification

```bash
# Build the image locally
docker build -t be-flowering:local .
docker run -p 3000:3000 --env-file .env be-flowering:local

# Worker dev (proxies to container locally)
npx wrangler dev --env staging
```

## Rollback

Re-deploy a previous image tag:

```bash
# Re-tag a known-good SHA as production and redeploy
docker pull docker.io/<ns>/be-flowering:<good-sha>
docker tag  docker.io/<ns>/be-flowering:<good-sha> docker.io/<ns>/be-flowering:production
docker push docker.io/<ns>/be-flowering:production
npx wrangler deploy --env production
```

Or revert the merge commit on `main` and let CI redeploy.

## Notes / Caveats

- Cloudflare does **not** cache Docker Hub images — every cold start pulls from Docker Hub. For high traffic, consider pushing to the Cloudflare managed registry (`registry.cloudflare.com`) instead; the deploy workflow can be switched to `wrangler containers push`.
- Keep the image lean (multi-stage build is already configured) — cold start scales with image size.
- Container `instance_type` and `max_instances` are set conservatively in `wrangler.toml`; tune per traffic.
- `Procfile` is no longer used (was Heroku/Railway). Safe to delete after the first successful CF deploy.
