# Phase 03 — Storage service → S3 client

**Priority:** high · **Status:** pending · No dependency on DB phases (parallelizable)

## Goal
Replace Supabase Storage usage with the Railway S3-compatible bucket, keeping the
public method signatures identical so callers don't change.

## Affected files
- `src/database/supabase-storage.service.ts` → rewrite (rename → `object-storage.service.ts`)
- `src/database/index.ts` — update export
- `src/app.module.ts` — provider + export (lines ~9, 67, 81)
- `src/modules/ai/ai.module.ts` — import + provider (lines ~25, 65)
- `src/modules/ai/services/transcription.service.ts` — update import/type only (line ~10, ctor)
- `src/config/app-configuration.ts` — add `storage` block
- `src/config/environment-validation-schema.ts` — add storage vars
- `.env.example` — add storage vars, remove `SUPABASE_*` (or keep commented if flag URLs still on Supabase)
- `package.json` — add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (deps), remove `@supabase/supabase-js` once unused

## Pre-checks (RT — do before writing code)
- **Bucket privacy:** confirm the Railway bucket `compact-samosa-4waqziim5o` is **private** (no public-read). The Supabase `audio-files` bucket was private + signed URLs; if the Railway bucket is public, the signed-URL scheme is meaningless and uploaded audio is world-readable. `PutObjectCommand` must NOT set a public-read ACL.
- **Presigned-GET support:** verify `https://t3.storageapi.dev` honors SigV4 presigned GET URLs (quick manual `getSignedUrl` + `curl` test). The current design's `getSignedUrl()` depends on it. If unsupported → fallback: keep objects private and stream them through a backend endpoint instead of handing out signed URLs (changes the public method shape — decide before implementing).

## Steps
1. `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
2. Add config:
   ```ts
   storage: {
     endpoint: process.env.STORAGE_ENDPOINT || '',          // https://t3.storageapi.dev
     bucket: process.env.STORAGE_BUCKET || '',               // compact-samosa-4waqziim5o
     accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
     secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
   }
   ```
   Add same keys (required strings) to the Joi/validation schema.
3. Rewrite the service — `S3Client({ endpoint, region: 'auto', forcePathStyle: true, credentials })`. Keep methods + return shapes:
   - `uploadAudio(buffer, userId, fileName)` → `PutObjectCommand` (key `${userId}/audio/${Date.now()}-${fileName}`, `ContentType: 'audio/mpeg'`), then return `{ path, signedUrl: await getSignedUrl(...) }`
   - `getSignedUrl(filePath, expiresIn=3600)` → `getSignedUrl(client, new GetObjectCommand({Bucket, Key}), { expiresIn })`
   - `deleteFile(filePath)` → `DeleteObjectCommand`
   - `listUserFiles(userId)` → `ListObjectsV2Command({ Prefix: \`${userId}/audio\` })`, map `Contents[].Key`
   - Keep the constructor guard: throw if endpoint/bucket/creds missing.
4. Update `index.ts`, `app.module.ts`, `ai.module.ts`, `transcription.service.ts` to new class name. Keep the DI working (class-based provider).
5. `npm run build` — zero `TS2307` / type errors.
6. `npm uninstall @supabase/supabase-js` if nothing else imports it (`grep -r "@supabase/supabase-js" src`).

## Notes
- No bulk file copy needed (audio not persisted). Bucket starts empty — fine.
- Don't hardcode endpoint/bucket — env only.

## Todo
- [ ] Pre-check: bucket is private, no public ACL on PUT
- [ ] Pre-check: presigned GET works against t3.storageapi.dev
- [ ] Install aws-sdk s3 packages
- [ ] Add storage config + validation
- [ ] Rewrite storage service as S3 client
- [ ] Update module wiring + callers
- [ ] `npm run build` clean
- [ ] Remove @supabase/supabase-js if unused
